import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  runLocalRoutine,
  tryReconcileLocalRunIssueAsync,
  tryMarkLocalRunInterruptedAsync,
  detectQuotaExceeded,
  detectTransientServiceError,
} from './runner.js';
import { cleanupStaleWorktrees, listActiveWorktrees } from './worktree.js';
import {
  KeyboardController,
  printKeybindingCheatSheet,
  printDaemonStatusSummary,
  promptTargetedInput,
  parseNumericTarget,
  printDaemonLogTail,
  inspectAndCleanWorktrees,
  printWorktreesInspection,
  formatDaemonStatusLine,
} from './daemon-keys.js';
import pc from 'picocolors';
import { renderFleetBanner } from './brand.js';
import {
  renderBacklogDiagnosticCard,
  isRoutineRunTitle,
  isRadarDigestTitle,
  formatTargetLabel,
  detectPeerReviewOutcome,
  formatPeerReviewOutcomeMessage,
  type BacklogTriageReport,
  type BacklogIssueInfo,
} from './terminal-card.js';
import {
  type RunUsageMetrics,
  type ActualPlanQuota,
  type QuotaDepletionResult,
  checkPlanQuotaDepletion,
  fetchActualPlanQuota,
} from './telemetry.js';
import { loadManifest } from './manifest.js';

const execFileAsync = promisify(execFile);

export type BacklogIssue = BacklogIssueInfo;
export type { BacklogTriageReport };

export type EvaluatedPROutcome =
  | 'approved'
  | 'approved_pending_ci'
  | 'bounced'
  | 'bounced_to_draft'
  | 'merged'
  | 'rejected'
  | 'failed'
  | string;

export type EvaluatedPRCiState = 'green' | 'pending' | 'other';

export interface EvaluatedPRRecord {
  headRefOid?: string;
  evaluatedAt: string;
  success: boolean;
  outcome?: EvaluatedPROutcome;
  ciState?: EvaluatedPRCiState;
}

export interface PRFailureRecord {
  failedAt: number;
  count: number;
}

export interface DaemonState {
  pid: number;
  startedAt: string;
  reviewIntervalMinutes: number;
  autoworkIntervalMinutes: number;
  routines: string[];
  lastReviewCheckAt?: string;
  lastAutoworkCheckAt?: string;
  status: 'idle' | 'working' | 'paused' | 'stopped';
  activeRoutine?: string;
  activeTarget?: string;
  activeWorktree?: string;
  evaluatedPRs?: Record<number, EvaluatedPRRecord>;
  failureCooldowns?: Record<number, PRFailureRecord>;
  sessionTokens?: number;
  fullBurn?: boolean;
}

export interface DaemonOptions {
  interval?: number; // legacy fallback interval (minutes)
  reviewInterval?: number; // minutes (default: 3)
  autoworkInterval?: number; // minutes (default: 30)
  quotaCooldownMinutes?: number; // minutes to pause checks on quota exhaustion (default: 15)
  prFailureCooldownMinutes?: number; // minutes to cooldown a failing PR before retrying (default: 15)
  routines?: string[];
  model?: string;
  foreground?: boolean;
  verbose?: boolean;
  fullBurn?: boolean;
  quotaThresholdPct?: number; // default: 20
  getPlanQuota?: (repoRoot: string) => Promise<ActualPlanQuota> | ActualPlanQuota;
  stdin?: any;
  getPRs?: (repoRoot: string) => Promise<ReviewablePR[]>;
  getBacklog?: (repoRoot: string) => Promise<BacklogTriageReport>;
  runRoutine?: (opts: any) => Promise<{
    success: boolean;
    exitCode?: number;
    quotaPaused?: boolean;
    quotaResetInfo?: string;
    transientServiceError?: boolean;
    output?: string;
    stderr?: string;
    usage?: RunUsageMetrics;
    planQuota?: ActualPlanQuota;
  }>;
}

export function getDaemonStatePath(repoRoot: string): string {
  return path.join(repoRoot, '.jonah-fleet', 'daemon.json');
}

export function readDaemonState(repoRoot: string): DaemonState | null {
  const statePath = getDaemonStatePath(repoRoot);
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as DaemonState;
  } catch {
    return null;
  }
}

export function writeDaemonState(repoRoot: string, state: DaemonState): void {
  const statePath = getDaemonStatePath(repoRoot);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Records routine session token usage in daemon state and persists it to disk.
 */
export function recordDaemonSessionUsage(
  repoRoot: string,
  state: DaemonState | undefined,
  usage?: RunUsageMetrics
): void {
  if (usage?.totalTokens && state) {
    state.sessionTokens = (state.sessionTokens || 0) + usage.totalTokens;
    writeDaemonState(repoRoot, state);
  }
}

export function clearDaemonState(repoRoot: string): void {
  const statePath = getDaemonStatePath(repoRoot);
  if (fs.existsSync(statePath)) {
    try {
      fs.unlinkSync(statePath);
    } catch {
      // Ignore unlink errors
    }
  }
}

export function isDaemonRunning(repoRoot: string): boolean {
  const state = readDaemonState(repoRoot);
  if (!state || !state.pid) return false;
  try {
    // Check if process exists by sending signal 0
    process.kill(state.pid, 0);
    return true;
  } catch {
    // Process is dead, clean up stale state
    clearDaemonState(repoRoot);
    return false;
  }
}

/**
 * Checks whether full burn mode is enabled across options, daemon state, environment variables, or manifest.
 */
export function isFullBurnEnabled(
  options: DaemonOptions = {},
  state?: DaemonState | null,
  repoRoot?: string
): boolean {
  if (options.fullBurn === true || state?.fullBurn === true) return true;
  if (
    process.env.JONAH_FLEET_FULL_BURN === 'true' ||
    process.env.JONAH_FLEET_FULL_BURN === '1' ||
    process.env.FULL_BURN === 'true' ||
    process.env.FULL_BURN === '1'
  ) {
    return true;
  }
  if (repoRoot) {
    try {
      const manifest = loadManifest(repoRoot);
      if (
        (manifest as any)?.budgets?.fullBurn === true ||
        (manifest as any)?.daemon?.fullBurn === true
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Checks real-time plan quota against the safety floor (<20% in 5h or 7days window) unless full-burn is enabled.
 */
export async function checkDaemonQuotaGuard(
  repoRoot: string,
  options: DaemonOptions = {},
  state?: DaemonState | null,
  cachedQuota?: ActualPlanQuota
): Promise<{ shouldStop: boolean; depletion?: QuotaDepletionResult }> {
  if (isFullBurnEnabled(options, state, repoRoot)) {
    return { shouldStop: false };
  }

  let quota = cachedQuota;
  if (!quota) {
    if (options.getPlanQuota) {
      quota = await options.getPlanQuota(repoRoot);
    } else {
      quota = await fetchActualPlanQuota({ repoRoot });
    }
  }

  if (!quota || !quota.available) {
    return { shouldStop: false };
  }

  const depletion = checkPlanQuotaDepletion(quota, {
    thresholdPct: options.quotaThresholdPct ?? 20,
    model: options.model,
  });

  if (depletion.depleted) {
    return { shouldStop: true, depletion };
  }

  return { shouldStop: false };
}

export interface ReviewablePR {
  number: number;
  headRefName: string;
  headRefOid?: string;
  title: string;
  reviewDecision?: string;
  statusCheckRollup?: Array<{
    status?: string;
    state?: string;
    conclusion?: string | null;
  }>;
  reviews?: Array<{
    id?: string;
    author?: { login: string };
    state?: string;
    commit?: { oid: string };
    submittedAt?: string;
    body?: string;
  }>;
  comments?: Array<{
    id?: string;
    author?: { login: string };
    body?: string;
    createdAt?: string;
  }>;
}

/**
 * Checks if a GitHub user login corresponds to a bot account or designated agent persona.
 */
export function isBotLogin(login?: string | null): boolean {
  if (!login) return false;
  const l = login.toLowerCase().trim();
  const configuredBot = process.env.AGENT_BOT_LOGIN?.toLowerCase().replace(/^@/, '');
  if (configuredBot && l === configuredBot) {
    return true;
  }
  return (
    l.endsWith('[bot]') ||
    l.endsWith('-bot') ||
    l.endsWith('_bot') ||
    l === 'github-actions' ||
    l === 'github-actions[bot]' ||
    l === 'jonah-fleet-bot'
  );
}

/**
 * Checks if a pull request has CI checks that are currently running, queued, or pending.
 */
export function isPRCiPending(pr: ReviewablePR): boolean {
  if (!pr.statusCheckRollup || !Array.isArray(pr.statusCheckRollup) || pr.statusCheckRollup.length === 0) {
    return false;
  }
  return pr.statusCheckRollup.some((check) => {
    if (check.status && check.status !== 'COMPLETED') {
      return true;
    }
    if (check.state && check.state === 'PENDING') {
      return true;
    }
    return false;
  });
}

/**
 * Checks if all CI checks on a pull request have completed successfully (green).
 */
export function isPRCiGreen(pr: ReviewablePR): boolean {
  if (!pr.statusCheckRollup || !Array.isArray(pr.statusCheckRollup) || pr.statusCheckRollup.length === 0) {
    return false;
  }
  if (isPRCiPending(pr)) {
    return false;
  }
  return pr.statusCheckRollup.every((check) => {
    const conclusion = (check.conclusion || '').toUpperCase();
    const state = (check.state || '').toUpperCase();
    if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') {
      return true;
    }
    if (state === 'SUCCESS') {
      return true;
    }
    return false;
  });
}

/**
 * Checks if any CI check on a pull request has explicitly failed or errored.
 */
export function isPRCiFailed(pr: ReviewablePR): boolean {
  if (!pr.statusCheckRollup || !Array.isArray(pr.statusCheckRollup) || pr.statusCheckRollup.length === 0) {
    return false;
  }
  return pr.statusCheckRollup.some((check) => {
    const conclusion = (check.conclusion || '').toUpperCase();
    const state = (check.state || '').toUpperCase();
    return (
      conclusion === 'FAILURE' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'CANCELLED' ||
      state === 'FAILURE' ||
      state === 'ERROR'
    );
  });
}

/**
 * Checks if a pull request has already received approval either through reviewDecision
 * or an APPROVED review from a reviewer/bot on its current head commit.
 */
export function isPRApproved(pr: ReviewablePR): boolean {
  if (pr.reviewDecision?.toUpperCase() === 'APPROVED') return true;
  if (pr.reviews && Array.isArray(pr.reviews)) {
    const hasApproved = pr.reviews.some((r) => {
      const state = (r.state || '').toUpperCase();
      if (state === 'APPROVED') return true;
      if (pr.headRefOid && r.commit?.oid === pr.headRefOid && /Approved for squash-merge/i.test(r.body || '')) {
        return true;
      }
      return false;
    });
    if (hasApproved) return true;
  }
  return false;
}

/**
 * Helper to safely extract a record by numeric key from Record or Map without casting.
 */
function getRecord<T>(
  record: Record<string | number, T> | Map<number, T> | undefined,
  key: number
): T | undefined {
  if (!record) return undefined;
  if (record instanceof Map) return record.get(key);
  return record[key] ?? record[String(key)];
}

export interface FilterReviewablePROptions {
  allowPendingCi?: boolean;
  evaluatedPRs?: Record<string | number, EvaluatedPRRecord> | Map<number, EvaluatedPRRecord>;
  failureCooldowns?: Record<string | number, PRFailureRecord> | Map<number, PRFailureRecord>;
  cooldownDurationMs?: number;
}

/**
 * Determines whether a pull request has already been evaluated or reviewed
 * on its current head commit, preventing wasteful re-review loops.
 */
export function isPRAlreadyEvaluated(
  pr: ReviewablePR,
  options: FilterReviewablePROptions = {}
): boolean {
  const headOid = pr.headRefOid;
  const prNum = pr.number;

  // 1. Check failure cooldown (from options or state)
  const cooldown = getRecord(options.failureCooldowns, prNum);
  if (cooldown) {
    const cooldownDurationMs = options.cooldownDurationMs ?? 15 * 60 * 1000;
    if (Date.now() - cooldown.failedAt < cooldownDurationMs) {
      return true;
    }
  }

  // 2. Check evaluatedPRs (from options or daemon state)
  const evaluatedPRs = options.evaluatedPRs;
  if (evaluatedPRs && headOid) {
    const record = getRecord(evaluatedPRs, prNum);
    if (record && record.headRefOid === headOid) {
      if (record.success) {
        // If it was already evaluated successfully on this commit:
        // Check if CI just turned green for an approved PR that was waiting for CI
        const isGreen = isPRCiGreen(pr);
        const wasGreen = record.ciState === 'green';
        if (
          isGreen &&
          !wasGreen &&
          (record.outcome === 'approved' || record.outcome === 'approved_pending_ci')
        ) {
          // Allow one sweep to perform the squash merge
          return false;
        }
        return true;
      }
    }
  }

  // 3. Check GitHub bot reviews on the current head commit
  if (headOid && pr.reviews && Array.isArray(pr.reviews)) {
    const botReview = pr.reviews.find(
      (r) => isBotLogin(r.author?.login) && r.commit?.oid === headOid
    );
    if (botReview) {
      const body = botReview.body || '';
      const state = (botReview.state || '').toUpperCase();

      // Blocking findings / bounce to draft / changes requested / escalation: do not re-review unchanged commit
      if (
        state === 'CHANGES_REQUESTED' ||
        /bounce.*draft/i.test(body) ||
        /blocking findings/i.test(body) ||
        /needs-human/i.test(body)
      ) {
        return true;
      }

      // If approved:
      if (state === 'APPROVED' || /Approved for squash-merge/i.test(body)) {
        if (isPRCiPending(pr) || isPRCiFailed(pr)) {
          return true;
        }
        if (evaluatedPRs) {
          const record = getRecord(evaluatedPRs, prNum);
          if (record && record.headRefOid === headOid && record.ciState === 'green') {
            return true;
          }
        }
      } else if (state === 'COMMENTED') {
        if (/Decision:/i.test(body) || /Findings Summary/i.test(body) || /## Standards/i.test(body)) {
          if (!isPRCiGreen(pr)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Filters a list of pull requests to include only reviewable PRs,
 * excluding automated release-please branches, release PR titles,
 * PRs with active CI checks in progress (unless allowPendingCi is true),
 * and PRs already evaluated or reviewed on the current head commit.
 */
export function filterReviewablePRs(
  prs: ReviewablePR[],
  options: FilterReviewablePROptions = {}
): ReviewablePR[] {
  return (prs || []).filter(
    (pr) =>
      pr &&
      typeof pr.number === 'number' &&
      !pr.headRefName?.startsWith('release-please--') &&
      !pr.title?.startsWith('chore(main): release') &&
      (options.allowPendingCi || !isPRCiPending(pr)) &&
      !isPRAlreadyEvaluated(pr, options)
  );
}

/**
 * Fast pre-flight check to query open ready PRs in ~100ms with 0 token cost,
 * excluding drafts, automated release-please branches, release PR titles,
 * PRs with active CI checks still running, and already evaluated PRs.
 */
export async function getOpenReviewablePRs(
  repoRoot: string,
  options: FilterReviewablePROptions = {}
): Promise<ReviewablePR[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--draft=false',
        '--json',
        'number,headRefName,headRefOid,title,statusCheckRollup,reviews',
      ],
      { cwd: repoRoot }
    );
    const prs = JSON.parse(stdout) as ReviewablePR[];
    const daemonState = options.evaluatedPRs ? null : readDaemonState(repoRoot);
    const effectiveOptions: FilterReviewablePROptions = {
      ...options,
      evaluatedPRs: options.evaluatedPRs || daemonState?.evaluatedPRs,
      failureCooldowns: options.failureCooldowns || daemonState?.failureCooldowns,
    };
    return filterReviewablePRs(prs, effectiveOptions);
  } catch {
    return [];
  }
}

/**
 * Fast pre-flight check to query number of open ready PRs in ~100ms with 0 token cost.
 */
export async function countOpenReadyPRs(repoRoot: string): Promise<number> {
  const prs = await getOpenReviewablePRs(repoRoot);
  return prs.length;
}

export interface BacklogPR {
  number: number;
  title?: string;
  body?: string;
  headRefName?: string;
  isDraft?: boolean;
  labels?: Array<{ name: string } | string>;
  assignees?: Array<{ login: string }>;
  url?: string;
}

/**
 * Classifies a list of open GitHub issues and pull requests according to the Autowork backlog taxonomy.
 */
export function classifyBacklogIssues(
  issues: BacklogIssue[],
  openPRs: BacklogPR[] = []
): BacklogTriageReport {
  const actionable: BacklogIssue[] = [];
  const inProgress: BacklogIssue[] = [];
  const gatedHuman: BacklogIssue[] = [];
  const awaitingInfo: BacklogIssue[] = [];
  const guardrails: BacklogIssue[] = [];
  const routineLogs: BacklogIssue[] = [];

  const readyPRReferencedIssues = new Set<number>();
  const draftPRReferencedIssues = new Set<number>();
  const gatedDraftPRReferencedIssues = new Set<number>();
  const humanAssignedDraftPRReferencedIssues = new Set<number>();

  const standaloneActionableDraftPRs: BacklogPR[] = [];
  const standaloneGatedDraftPRs: BacklogPR[] = [];
  const standaloneHumanDraftPRs: BacklogPR[] = [];

  const knownIssueNumbers = new Set(issues.map((i) => i.number));

  for (const pr of openPRs) {
    // Skip automated release PRs
    if (
      pr.headRefName?.startsWith('release-please--') ||
      pr.title?.startsWith('chore(main): release')
    ) {
      continue;
    }

    const textToScan = `${pr.title || ''} ${pr.body || ''} ${pr.headRefName || ''}`;
    const matches = textToScan.matchAll(/#(\d+)\b/g);
    const referencedIssues = new Set<number>();
    for (const m of matches) {
      referencedIssues.add(parseInt(m[1], 10));
    }
    const branchMatch = (pr.headRefName || '').match(/(?:^|[-_/])(\d+)(?:[-_/]|$)/);
    if (branchMatch) {
      referencedIssues.add(parseInt(branchMatch[1], 10));
    }

    const isDraft = Boolean(pr.isDraft);
    const prLabelNames = (pr.labels || []).map((l) =>
      (typeof l === 'string' ? l : l.name).toLowerCase()
    );
    const hasNeedsHuman = prLabelNames.includes('needs-human');
    const hasHumanAssignee = (pr.assignees || []).some((a) => !isBotLogin(a.login));

    let hasKnownIssue = false;
    for (const issueNum of referencedIssues) {
      if (knownIssueNumbers.has(issueNum)) {
        hasKnownIssue = true;
      }
      if (!isDraft) {
        readyPRReferencedIssues.add(issueNum);
      } else if (hasNeedsHuman) {
        gatedDraftPRReferencedIssues.add(issueNum);
      } else if (hasHumanAssignee) {
        humanAssignedDraftPRReferencedIssues.add(issueNum);
      } else {
        draftPRReferencedIssues.add(issueNum);
      }
    }

    if (isDraft && !hasKnownIssue) {
      if (hasNeedsHuman) {
        standaloneGatedDraftPRs.push(pr);
      } else if (hasHumanAssignee) {
        standaloneHumanDraftPRs.push(pr);
      } else {
        standaloneActionableDraftPRs.push(pr);
      }
    }
  }

  for (const issue of issues) {
    const labelNames = (issue.labels || []).map((l) =>
      (typeof l === 'string' ? l : l.name).toLowerCase()
    );

    // 1. Routine logs (operational metadata)
    if (labelNames.includes('routine-log') || isRoutineRunTitle(issue.title)) {
      routineLogs.push(issue);
      continue;
    }

    // 2. Gated by human (needs-human, needs-attention, radar/intel digest on issue OR on associated draft PR)
    if (
      labelNames.includes('needs-human') ||
      labelNames.includes('needs-attention') ||
      labelNames.includes('radar') ||
      isRadarDigestTitle(issue.title) ||
      gatedDraftPRReferencedIssues.has(issue.number)
    ) {
      gatedHuman.push(issue);
      continue;
    }

    // 3. Awaiting info / design
    if (labelNames.includes('needs-info') || labelNames.includes('needs-design')) {
      awaitingInfo.push(issue);
      continue;
    }

    // 4. Metric guardrails / wontfix
    if (labelNames.includes('measurement') || labelNames.includes('wontfix')) {
      guardrails.push(issue);
      continue;
    }

    // 5. In progress: active open ready PR awaiting review, or assigned to non-bot human
    const hasHumanAssignee = (issue.assignees || []).some((a) => !isBotLogin(a.login));
    const hasReadyPR = readyPRReferencedIssues.has(issue.number);
    const hasHumanDraftPR = humanAssignedDraftPRReferencedIssues.has(issue.number);

    if (hasReadyPR || hasHumanAssignee || hasHumanDraftPR) {
      inProgress.push(issue);
      continue;
    }

    // 6. Actionable:
    // - Issue with an open draft PR needing autowork convergence (bounced to draft or drafted)
    // - OR unassigned/bot-assigned issue with no open PR and no gating labels
    actionable.push(issue);
  }

  // Include standalone draft PRs that do not link to any known issue
  for (const pr of standaloneActionableDraftPRs) {
    actionable.push({
      number: pr.number,
      title: pr.title || `PR #${pr.number}`,
      labels: (pr.labels || []).map((l) => (typeof l === 'string' ? { name: l } : l)),
      assignees: pr.assignees,
      url: pr.url,
    });
  }

  for (const pr of standaloneGatedDraftPRs) {
    gatedHuman.push({
      number: pr.number,
      title: pr.title || `PR #${pr.number}`,
      labels: (pr.labels || []).map((l) => (typeof l === 'string' ? { name: l } : l)),
      assignees: pr.assignees,
      url: pr.url,
    });
  }

  for (const pr of standaloneHumanDraftPRs) {
    inProgress.push({
      number: pr.number,
      title: pr.title || `PR #${pr.number}`,
      labels: (pr.labels || []).map((l) => (typeof l === 'string' ? { name: l } : l)),
      assignees: pr.assignees,
      url: pr.url,
    });
  }

  return {
    actionable,
    inProgress,
    gatedHuman,
    awaitingInfo,
    guardrails,
    routineLogs,
    total:
      issues.length +
      standaloneActionableDraftPRs.length +
      standaloneGatedDraftPRs.length +
      standaloneHumanDraftPRs.length,
  };
}

/**
 * Fast GitHub CLI query for open issues in ~150ms with 0 token cost.
 */
export async function getBacklogIssues(repoRoot: string): Promise<BacklogIssue[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'list', '--state', 'open', '--json', 'number,title,labels,assignees,url', '--limit', '50'],
      { cwd: repoRoot, timeout: 5000 }
    );
    return JSON.parse(stdout || '[]') as BacklogIssue[];
  } catch {
    return [];
  }
}

/**
 * Fast GitHub CLI query for open pull requests with titles, bodies, and draft status.
 */
export async function getOpenPRsForBacklog(
  repoRoot: string
): Promise<BacklogPR[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'number,title,body,headRefName,isDraft,labels,assignees,url', '--limit', '50'],
      { cwd: repoRoot, timeout: 5000 }
    );
    return JSON.parse(stdout || '[]') as BacklogPR[];
  } catch {
    return [];
  }
}

/**
 * Preflight query and classification for the full repository backlog with 0 token cost.
 */
export async function getBacklogTriageReport(repoRoot: string): Promise<BacklogTriageReport> {
  const [issues, openPRs] = await Promise.all([
    getBacklogIssues(repoRoot),
    getOpenPRsForBacklog(repoRoot),
  ]);
  return classifyBacklogIssues(issues, openPRs);
}

/**
 * Starts the daemon in the background by detaching a child process.
 */
export async function startBackgroundDaemon(repoRoot: string, options: DaemonOptions = {}): Promise<DaemonState> {
  if (isDaemonRunning(repoRoot)) {
    const existing = readDaemonState(repoRoot);
    throw new Error(`Daemon is already running with PID ${existing?.pid}`);
  }

  const guard = await checkDaemonQuotaGuard(repoRoot, options);
  if (guard.shouldStop) {
    throw new Error(
      `Plan quota is below 20% (${guard.depletion?.message}). Daemon stopped to protect compute budget. Run with --full-burn to bypass this guard.`
    );
  }

  const reviewInterval = options.reviewInterval || 3;
  const autoworkInterval = options.autoworkInterval || options.interval || 30;
  const routines = options.routines || ['peer-review', 'autowork'];
  const fullBurn = isFullBurnEnabled(options, undefined, repoRoot);

  // Path to cli entrypoint or executable
  const logFilePath = path.join(repoRoot, '.jonah-fleet', 'daemon.log');
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  const logFd = fs.openSync(logFilePath, 'a');

  // Spawn node with current entrypoint running daemon foreground mode
  const cliPath = process.argv[1];
  const args = [
    'daemon',
    '--foreground',
    '--review-interval',
    String(reviewInterval),
    '--autowork-interval',
    String(autoworkInterval),
    '--routines',
    routines.join(','),
  ];
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.verbose) {
    args.push('--verbose');
  }
  if (fullBurn) {
    args.push('--full-burn');
  }

  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, JONAH_FLEET_DAEMON: 'true', ...(fullBurn ? { JONAH_FLEET_FULL_BURN: 'true' } : {}) },
  });

  child.unref();

  const state: DaemonState = {
    pid: child.pid!,
    startedAt: new Date().toISOString(),
    reviewIntervalMinutes: reviewInterval,
    autoworkIntervalMinutes: autoworkInterval,
    routines,
    status: 'idle',
    fullBurn,
  };

  writeDaemonState(repoRoot, state);
  return state;
}

/**
 * Stops a running daemon process.
 */
export async function stopDaemon(repoRoot: string): Promise<boolean> {
  const state = readDaemonState(repoRoot);
  if (!state || !state.pid) return false;

  try {
    process.kill(state.pid, 'SIGTERM');
    clearDaemonState(repoRoot);
    await cleanupStaleWorktrees(repoRoot);
    return true;
  } catch {
    clearDaemonState(repoRoot);
    return false;
  }
}

export interface ReconcileOrphanedRunsOptions {
  repoRoot: string;
  queryIssues?: (repoRoot: string) => Promise<Array<{ number: number; title: string; createdAt: string }>>;
  reconcileRun?: (
    repoRoot: string,
    issueNumber: number,
    report: string | undefined,
    isSuccess: boolean,
    routine?: string
  ) => Promise<boolean>;
}

export async function queryOrphanedLocalRunIssues(
  repoRoot: string
): Promise<Array<{ number: number; title: string; createdAt: string }>> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'list', '--state', 'open', '--label', 'runner:local,status:running', '--json', 'number,title,createdAt', '--limit', '20'],
      { cwd: repoRoot }
    );
    return JSON.parse(stdout || '[]') as Array<{ number: number; title: string; createdAt: string }>;
  } catch {
    return [];
  }
}

/**
 * Scans for open routine run issues labeled `runner:local,status:running` that were abandoned
 * by a process crash, SIGKILL, or host machine reboot, and reconciles them.
 * Operates asynchronously and fails gracefully on network / CLI errors without preventing daemon startup.
 */
export async function reconcileOrphanedLocalRuns(
  optionsOrRepoRoot: string | ReconcileOrphanedRunsOptions
): Promise<number> {
  const options: ReconcileOrphanedRunsOptions =
    typeof optionsOrRepoRoot === 'string'
      ? { repoRoot: optionsOrRepoRoot }
      : optionsOrRepoRoot;

  const { repoRoot } = options;
  const queryFn = options.queryIssues || queryOrphanedLocalRunIssues;

  try {
    const issues = await queryFn(repoRoot);
    if (!issues || issues.length === 0) return 0;

    const runsDir = path.join(repoRoot, '.jonah-fleet', 'runs');
    let reconciledCount = 0;
    const hostname = os.hostname();

    for (const issue of issues) {
      try {
        let completedReport: string | undefined;
        let isSuccess = false;
        let metaRoutine: string | undefined;

        if (fs.existsSync(runsDir)) {
          const files = fs.readdirSync(runsDir);
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const meta = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
                if (meta.issueNumber === issue.number) {
                  metaRoutine = meta.routine;
                  const mdFile = file.replace(/\.json$/, '.md');
                  const mdPath = path.join(runsDir, mdFile);
                  if (fs.existsSync(mdPath)) {
                    completedReport = fs.readFileSync(mdPath, 'utf8');
                    isSuccess = meta.success === true || meta.exitCode === 0;
                    break;
                  }
                }
              } catch {}
            }
          }
        }

        if (options.reconcileRun) {
          const ok = await options.reconcileRun(
            repoRoot,
            issue.number,
            completedReport,
            isSuccess,
            metaRoutine
          );
          if (ok) reconciledCount++;
        } else if (completedReport) {
          const ok = await tryReconcileLocalRunIssueAsync(
            repoRoot,
            issue.number,
            completedReport,
            isSuccess ? 0 : 1,
            hostname,
            metaRoutine
          );
          if (ok) reconciledCount++;
        } else {
          const ok = await tryMarkLocalRunInterruptedAsync(
            repoRoot,
            issue.number,
            hostname,
            'Host machine daemon process was terminated before completion (e.g. machine reboot or SIGKILL).',
            metaRoutine || 'local-routine'
          );
          if (ok) reconciledCount++;
        }
      } catch {
        // Granular error recovery: individual issue failure does not abort processing remaining issues
      }
    }

    if (reconciledCount > 0) {
      console.log(
        pc.yellow(
          `\n⚠️  Reconciled ${reconciledCount} orphaned local routine run issue(s) from previous session.`
        )
      );
    }

    return reconciledCount;
  } catch {
    return 0;
  }
}

export interface DrainReviewQueueOptions {
  repoRoot: string;
  state?: DaemonState;
  options?: DaemonOptions;
  isStopping?: () => boolean;
  clearTicker?: () => void;
  getPRs?: (repoRoot: string) => Promise<ReviewablePR[]>;
  runRoutine?: (opts: any) => Promise<{
    success: boolean;
    exitCode?: number;
    quotaPaused?: boolean;
    quotaResetInfo?: string;
    transientServiceError?: boolean;
    output?: string;
    stderr?: string;
    usage?: RunUsageMetrics;
    planQuota?: ActualPlanQuota;
  }>;
  onAttempted?: (prNumber: number) => void;
  failureCooldowns?: Map<number, PRFailureRecord>;
  onQuotaExhausted?: (resetInfo?: string) => void;
  onQuotaDepleted?: (depletion: QuotaDepletionResult) => void;
}

/**
 * Records a PR failure in cooldown tracking and daemon state.
 */
function recordPRFailure(
  prNum: number,
  headRefOid: string | undefined,
  failureCooldowns?: Map<number, PRFailureRecord>,
  state?: DaemonState
): void {
  const prev = failureCooldowns?.get(prNum);
  const nextRecord = { failedAt: Date.now(), count: (prev?.count || 0) + 1 };
  failureCooldowns?.set(prNum, nextRecord);
  if (state) {
    if (!state.failureCooldowns) state.failureCooldowns = {};
    state.failureCooldowns[prNum] = nextRecord;
    if (!state.evaluatedPRs) state.evaluatedPRs = {};
    state.evaluatedPRs[prNum] = {
      headRefOid,
      evaluatedAt: new Date().toISOString(),
      success: false,
      outcome: 'failed',
    };
  }
}

/**
 * Sequentially drains all open reviewable PRs by executing peer-review in isolated worktrees.
 * Tracks attempted PRs per pass to prevent infinite loops on stalled or repeatedly unmerged PRs.
 */
export async function drainReviewQueue(drainOptions: DrainReviewQueueOptions): Promise<void> {
  const {
    repoRoot,
    state,
    options = {},
    isStopping = () => false,
    clearTicker,
    getPRs = getOpenReviewablePRs,
    runRoutine = runLocalRoutine,
    onAttempted,
    failureCooldowns,
    onQuotaExhausted,
    onQuotaDepleted,
  } = drainOptions;

  if (isStopping()) return;

  const guard = await checkDaemonQuotaGuard(repoRoot, options, state);
  if (guard.shouldStop) {
    if (clearTicker) clearTicker();
    console.warn(
      pc.red(
        `\n🛑 Peer Review Watchdog stopped: Plan quota is below 20% (${guard.depletion?.message}).`
      )
    );
    onQuotaDepleted?.(guard.depletion!);
    return;
  }

  if (state) {
    state.lastReviewCheckAt = new Date().toISOString();
    writeDaemonState(repoRoot, state);
  }

  let reviewablePRs: ReviewablePR[] = [];
  try {
    reviewablePRs = await getPRs(repoRoot);
  } catch (err: any) {
    console.error(pc.red(`✗ Failed to query reviewable PRs: ${err.message}`));
    return;
  }

  if (reviewablePRs.length === 0) {
    if (options.verbose) {
      console.log(pc.dim(`[${new Date().toLocaleTimeString()}] Peer Review Watchdog: 0 ready PRs found (0 tokens used).`));
    }
    return;
  }

  const attemptedPRNumbers = new Set<number>();
  const cooldownDurationMs = (options.prFailureCooldownMinutes ?? 15) * 60 * 1000;

  while (!isStopping() && reviewablePRs.length > 0) {
    const now = Date.now();
    const candidatePRs = reviewablePRs.filter((pr) => {
      if (attemptedPRNumbers.has(pr.number)) return false;
      const cooldown = failureCooldowns?.get(pr.number);
      if (cooldown && now - cooldown.failedAt < cooldownDurationMs) {
        return false;
      }
      return true;
    });

    if (candidatePRs.length === 0) {
      if (options.verbose) {
        console.log(
          pc.dim(
            `[${new Date().toLocaleTimeString()}] All ${reviewablePRs.length} remaining ready PR(s) were already evaluated or in failure cooldown in this drain pass.`
          )
        );
      }
      break;
    }

    const totalRemaining = candidatePRs.length;
    const currentPR = candidatePRs[0];
    const targetLabel = formatTargetLabel(`PR #${currentPR.number}`, currentPR.title);
    let targetPRStr: string | undefined = targetLabel;

    const loopGuard = await checkDaemonQuotaGuard(repoRoot, options, state);
    if (loopGuard.shouldStop) {
      if (clearTicker) clearTicker();
      console.warn(
        pc.red(
          `\n🛑 Peer Review Watchdog stopped: Plan quota is below 20% (${loopGuard.depletion?.message}).`
        )
      );
      onQuotaDepleted?.(loopGuard.depletion!);
      break;
    }

    try {
      if (clearTicker) clearTicker();
      if (state) {
        state.status = 'working';
        state.activeRoutine = 'peer-review';
        state.activeTarget = targetLabel;
        writeDaemonState(repoRoot, state);
      }

      console.log(
        pc.cyan(
          `\n[${new Date().toLocaleTimeString()}] 🔍 Peer Review Watchdog: Draining PR backlog (${totalRemaining} PR(s) remaining). Starting review session on ${targetLabel}...`
        )
      );
      await cleanupStaleWorktrees(repoRoot);

      const isFastPath = isPRCiGreen(currentPR) && isPRApproved(currentPR);
      const result = await runRoutine({
        targetDir: repoRoot,
        routine: 'peer-review',
        pr: currentPR.number,
        title: currentPR.title,
        model: options.model,
        verbose: options.verbose,
        noWorktree: false,
        fastPathMerge: isFastPath,
        onTargetDetected: (target: string) => {
          targetPRStr = target;
          if (state) {
            state.activeTarget = target;
            writeDaemonState(repoRoot, state);
          }
        },
      });

      if (result.planQuota) {
        const postGuard = await checkDaemonQuotaGuard(repoRoot, options, state, result.planQuota);
        if (postGuard.shouldStop) {
          if (clearTicker) clearTicker();
          console.warn(
            pc.red(
              `\n🛑 Peer Review Watchdog stopped: Plan quota dropped below 20% after routine (${postGuard.depletion?.message}).`
            )
          );
          onQuotaDepleted?.(postGuard.depletion!);
          break;
        }
      }

      // Record attempted PR number from detected target or candidate list
      const activeTargetStr = targetPRStr as string | undefined;
      const match = activeTargetStr?.match(/PR\s*#?([0-9]+)/i);
      const prNum = match ? parseInt(match[1], 10) : currentPR.number;
      if (typeof prNum === 'number') {
        attemptedPRNumbers.add(prNum);
        onAttempted?.(prNum);
      }

      recordDaemonSessionUsage(repoRoot, state, result.usage);

      const isQuota =
        result.quotaPaused ||
        (!result.success &&
          detectQuotaExceeded(result.output || '', result.stderr || '').isQuota);

      if (isQuota) {
        const resetInfo =
          result.quotaResetInfo ||
          detectQuotaExceeded(result.output || '', result.stderr || '').resetInfo;
        console.warn(
          pc.yellow(
            `\n⚠️  Peer Review on ${targetLabel} paused due to LLM quota exhaustion (${resetInfo || 'RESOURCE_EXHAUSTED / 429'}).`
          )
        );
        if (typeof prNum === 'number') {
          const prev = failureCooldowns?.get(prNum);
          failureCooldowns?.set(prNum, { failedAt: Date.now(), count: (prev?.count || 0) + 1 });
        }
        onQuotaExhausted?.(resetInfo);
        break;
      }

      const isTransient =
        result.transientServiceError ||
        (!result.success &&
          detectTransientServiceError(result.output || '', result.stderr || ''));

      if (isTransient) {
        console.warn(
          pc.yellow(
            `\n⚠️  Peer Review on ${targetLabel} encountered transient service error (503 UNAVAILABLE). PR will remain eligible for next sweep without failure cooldown.\n`
          )
        );
        break;
      }

      if (result.success) {
        const outcome =
          (result as any).outcome ||
          detectPeerReviewOutcome({
            output: result.output,
            prNumber: prNum,
            repoRoot,
          });
        console.log(formatPeerReviewOutcomeMessage(targetLabel, outcome, 'Local'));
        if (typeof prNum === 'number') {
          failureCooldowns?.delete(prNum);
          if (state) {
            if (!state.evaluatedPRs) state.evaluatedPRs = {};
            state.evaluatedPRs[prNum] = {
              headRefOid: currentPR.headRefOid,
              evaluatedAt: new Date().toISOString(),
              success: true,
              outcome,
              ciState: isPRCiGreen(currentPR) ? 'green' : isPRCiPending(currentPR) ? 'pending' : 'other',
            };
            if (state.failureCooldowns) {
              delete state.failureCooldowns[prNum];
            }
          }
        }
      } else {
        console.warn(pc.yellow(`⚠️  Local peer-review on ${targetLabel} completed with code ${result.exitCode}.\n`));
        if (typeof prNum === 'number') {
          recordPRFailure(prNum, currentPR.headRefOid, failureCooldowns, state);
        }
      }
    } catch (err: any) {
      const isTransientErr = detectTransientServiceError(err.message || '', '');
      if (isTransientErr) {
        console.warn(
          pc.yellow(
            `\n⚠️  Peer Review on ${targetLabel} encountered transient service error (${err.message}). PR will remain eligible for next sweep without failure cooldown.\n`
          )
        );
        break;
      }
      console.error(pc.red(`✗ Error in peer-review on ${targetLabel}: ${err.message}`));
      if (currentPR) {
        attemptedPRNumbers.add(currentPR.number);
        onAttempted?.(currentPR.number);
        recordPRFailure(currentPR.number, currentPR.headRefOid, failureCooldowns, state);
      }
    } finally {
      if (state) {
        state.status = 'idle';
        state.activeRoutine = undefined;
        state.activeTarget = undefined;
        writeDaemonState(repoRoot, state);
      }
    }

    // Re-query reviewable PRs after session
    try {
      reviewablePRs = await getPRs(repoRoot);
    } catch (err: any) {
      console.error(pc.red(`✗ Failed to re-query reviewable PRs: ${err.message}`));
      break;
    }
  }
}


export interface PerformAutoworkScanOptions {
  repoRoot: string;
  state?: DaemonState;
  options?: DaemonOptions;
  isStopping?: () => boolean;
  clearTicker?: () => void;
  getPRs?: (repoRoot: string) => Promise<ReviewablePR[]>;
  getBacklog?: (repoRoot: string) => Promise<BacklogTriageReport>;
  runRoutine?: (opts: any) => Promise<{
    success: boolean;
    exitCode?: number;
    quotaPaused?: boolean;
    quotaResetInfo?: string;
    transientServiceError?: boolean;
    output?: string;
    stderr?: string;
    usage?: RunUsageMetrics;
    planQuota?: ActualPlanQuota;
  }>;
  onDiagnosticCard?: (card: string) => void;
  onAttempted?: (prNumber: number) => void;
  failureCooldowns?: Map<number, PRFailureRecord>;
  onQuotaExhausted?: (resetInfo?: string) => void;
  onQuotaDepleted?: (depletion: QuotaDepletionResult) => void;
}

/**
 * Performs an autowork backlog scan with zero-token preflight check.
 * Drains reviewable PRs first, evaluates backlog, and bypasses worktree creation
 * when zero actionable issues exist.
 */
export async function performAutoworkScan(
  scanOptions: PerformAutoworkScanOptions
): Promise<{ executed: boolean; reason?: string }> {
  const {
    repoRoot,
    state,
    options = {},
    isStopping = () => false,
    clearTicker,
    getPRs = getOpenReviewablePRs,
    getBacklog = options.getBacklog || getBacklogTriageReport,
    runRoutine = options.runRoutine || runLocalRoutine,
    onDiagnosticCard,
  } = scanOptions;

  if (isStopping()) return { executed: false, reason: 'stopping' };

  const initialGuard = await checkDaemonQuotaGuard(repoRoot, options, state);
  if (initialGuard.shouldStop) {
    if (clearTicker) clearTicker();
    console.warn(
      pc.red(
        `\n🛑 Autowork Backlog Scan stopped: Plan quota depleted (<20% remaining). ${initialGuard.depletion?.message}`
      )
    );
    scanOptions.onQuotaDepleted?.(initialGuard.depletion!);
    return { executed: false, reason: 'quota_depleted' };
  }

  const routines = options.routines || ['peer-review', 'autowork'];

  // Strict priority invariant: drain reviewable PRs before running autowork
  if (routines.includes('peer-review')) {
    const pendingPRs = (await getPRs(repoRoot)).length;
    if (pendingPRs > 0) {
      console.log(
        pc.cyan(
          `\n[${new Date().toLocaleTimeString()}] ⏳ Autowork paused: draining ${pendingPRs} reviewable PR(s) first...`
        )
      );
      await drainReviewQueue({
        repoRoot,
        state,
        options,
        isStopping,
        clearTicker,
        getPRs,
        runRoutine,
        onAttempted: scanOptions.onAttempted,
        failureCooldowns: scanOptions.failureCooldowns,
        onQuotaExhausted: scanOptions.onQuotaExhausted,
        onQuotaDepleted: scanOptions.onQuotaDepleted,
      });

      const remainingPRs = (await getPRs(repoRoot)).length;
      if (remainingPRs > 0) {
        console.log(
          pc.yellow(
            `\n[${new Date().toLocaleTimeString()}] ⚠️  Review backlog still has ${remainingPRs} pending PR(s). Postponing autowork session.`
          )
        );
        return { executed: false, reason: 'pending_prs' };
      }
    }
  }

  // Zero-Token Preflight Check
  const report = await getBacklog(repoRoot);

  if (report.actionable.length === 0) {
    if (clearTicker) clearTicker();
    const card = renderBacklogDiagnosticCard(report);
    console.log('\n' + card + '\n');
    onDiagnosticCard?.(card);
    return { executed: false, reason: 'zero_actionable' };
  }

  // Actionable issues exist -> proceed with full autonomous execution
  if (state) {
    state.lastAutoworkCheckAt = new Date().toISOString();
    state.status = 'working';
    state.activeRoutine = 'autowork';
    writeDaemonState(repoRoot, state);
  }

  if (clearTicker) clearTicker();
  console.log(
    pc.cyan(
      `\n[${new Date().toLocaleTimeString()}] 🚀 Autowork Backlog Scan: Found ${report.actionable.length} actionable issue(s). Starting session...`
    )
  );
  await cleanupStaleWorktrees(repoRoot);

  const result = await runRoutine({
    targetDir: repoRoot,
    routine: 'autowork',
    model: options.model,
    verbose: options.verbose,
    noWorktree: false,
    onTargetDetected: (target: string) => {
      if (state) {
        state.activeTarget = target;
        writeDaemonState(repoRoot, state);
      }
    },
  });

  recordDaemonSessionUsage(repoRoot, state, result.usage);

  if (result.planQuota) {
    const postRoutineGuard = await checkDaemonQuotaGuard(repoRoot, options, state, result.planQuota);
    if (postRoutineGuard.shouldStop) {
      if (clearTicker) clearTicker();
      console.warn(
        pc.red(
          `\n🛑 Autowork Scan stopped: Plan quota dropped below 20% after routine (${postRoutineGuard.depletion?.message}).`
        )
      );
      scanOptions.onQuotaDepleted?.(postRoutineGuard.depletion!);
      return { executed: true, reason: 'quota_depleted' };
    }
  }

  const isQuota =
    result.quotaPaused ||
    (!result.success && detectQuotaExceeded(result.output || '', result.stderr || '').isQuota);

  if (isQuota) {
    const resetInfo =
      result.quotaResetInfo ||
      detectQuotaExceeded(result.output || '', result.stderr || '').resetInfo;
    console.warn(
      pc.yellow(
        `\n⚠️  Autowork paused due to LLM quota exhaustion (${resetInfo || 'RESOURCE_EXHAUSTED / 429'}).`
      )
    );
    scanOptions.onQuotaExhausted?.(resetInfo);
    return { executed: true, reason: 'quota_exhausted' };
  }

  const isTransient =
    result.transientServiceError ||
    (!result.success && detectTransientServiceError(result.output || '', result.stderr || ''));

  if (isTransient) {
    console.warn(
      pc.yellow(
        `\n⚠️  Autowork encountered transient service error (503 UNAVAILABLE). Routine will retry on next cycle without failure penalty.\n`
      )
    );
    return { executed: true, reason: 'transient_service_error' };
  }

  if (result.success) {
    console.log(pc.green(`✓ Local autowork completed successfully.\n`));
  } else {
    console.warn(pc.yellow(`⚠️  Local autowork completed with code ${result.exitCode}.\n`));
  }

  return { executed: true };
}

/**
 * Initializes and persists daemon state, and populates in-memory failure cooldowns.
 */
export function initializeDaemonState(
  repoRoot: string,
  options: DaemonOptions = {}
): { state: DaemonState; failureCooldowns: Map<number, PRFailureRecord> } {
  const reviewInterval = options.reviewInterval || 3;
  const autoworkInterval = options.autoworkInterval || options.interval || 30;
  const routines = options.routines || ['peer-review', 'autowork'];

  const existingState = readDaemonState(repoRoot);
  const state: DaemonState = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    reviewIntervalMinutes: reviewInterval,
    autoworkIntervalMinutes: autoworkInterval,
    routines,
    status: 'idle',
    evaluatedPRs: existingState?.evaluatedPRs,
    failureCooldowns: existingState?.failureCooldowns,
    fullBurn: isFullBurnEnabled(options, existingState, repoRoot),
  };
  writeDaemonState(repoRoot, state);

  const failureCooldowns = new Map<number, PRFailureRecord>();
  if (state.failureCooldowns) {
    for (const [key, val] of Object.entries(state.failureCooldowns)) {
      failureCooldowns.set(parseInt(key, 10), val);
    }
  }

  return { state, failureCooldowns };
}

/**
 * Runs the multi-cadence polling daemon loop in the current process with interactive controls.
 */
export async function runDaemonLoop(repoRoot: string, options: DaemonOptions = {}): Promise<void> {
  const reviewInterval = options.reviewInterval || 3;
  const autoworkInterval = options.autoworkInterval || options.interval || 30;
  const routines = options.routines || ['peer-review', 'autowork'];

  const { state, failureCooldowns } = initializeDaemonState(repoRoot, options);

  const initialGuard = await checkDaemonQuotaGuard(repoRoot, options, state);
  if (initialGuard.shouldStop) {
    console.warn(
      pc.red(
        `\n🛑 Daemon stopped: Plan quota is below 20% (${initialGuard.depletion?.message}).\n` +
          `   Remaining quota must stay >= 20% for 5h and 7days windows.\n` +
          `   To bypass this safety limit, start with --full-burn or set FULL_BURN=true.\n`
      )
    );
    clearDaemonState(repoRoot);
    return;
  }

  const isFullBurn = isFullBurnEnabled(options, state, repoRoot);

  console.log(
    renderFleetBanner({
      command: 'DAEMON',
      subtitle: 'LOCAL MULTI-CADENCE RUNNER',
      details: [
        { label: 'PID', value: String(process.pid) },
        { label: 'Review Watchdog', value: `Every ${reviewInterval}m (zero-token preflight)` },
        { label: 'Autowork Scan', value: `Every ${autoworkInterval}m` },
        { label: 'Routines', value: routines.join(', ') },
        { label: 'Full Burn', value: isFullBurn ? 'ENABLED' : 'DISABLED (stops at <20% quota)' },
        { label: 'Target', value: repoRoot },
        { label: 'Hotkeys', value: "'r' review · 'a' autowork · 'p' pause · 's' status · 'b' burn · '?' help" },
      ],
    })
  );
  console.log(pc.bold(pc.cyan(`\n⚡ Jonah Fleet Local Agent Daemon Active (PID: ${process.pid})\n`)));

  let isStopping = false;
  let isGracefulStopping = false;
  let isWorking = false;
  let isPaused = false;
  let isPrompting = false;
  let pendingRoutine: 'peer-review' | 'autowork' | null = null;
  let keyboard: KeyboardController | undefined;
  let tickerInterval: NodeJS.Timeout | undefined;
  let stopResolve: (() => void) | undefined;

  // Set up decoupled intervals
  const reviewIntervalMs = reviewInterval * 60 * 1000;
  const autoworkIntervalMs = autoworkInterval * 60 * 1000;

  const quotaCooldownMs = (options.quotaCooldownMinutes ?? 15) * 60 * 1000;
  let quotaCooldownUntil: number | undefined;

  const handleQuotaPause = (resetInfo?: string) => {
    const until = Date.now() + quotaCooldownMs;
    quotaCooldownUntil = until;
    nextReviewCheckTime = until;
    nextAutoworkCheckTime = Math.max(nextAutoworkCheckTime, until);
    const resetMsg = resetInfo || 'RESOURCE_EXHAUSTED / 429';
    console.warn(
      pc.yellow(
        `\n[${new Date().toLocaleTimeString()}] ⏸️  LLM quota exhausted (${resetMsg}). Deferring checks for ${Math.round(quotaCooldownMs / 60000)}m...`
      )
    );
  };

  let nextReviewCheckTime = Date.now() + (routines.includes('peer-review') ? reviewIntervalMs : Infinity);
  let nextAutoworkCheckTime = Date.now() + (routines.includes('autowork') ? autoworkIntervalMs : Infinity);
  let lastOpenPRCount: number | undefined = undefined;

  const getPRsFn = options.getPRs || getOpenReviewablePRs;
  const runRoutineFn = options.runRoutine || runLocalRoutine;

  const clearTicker = () => {
    if (process.stderr.isTTY && !options.verbose) {
      process.stderr.write('\r\x1b[K');
    }
  };

  const updateTicker = () => {
    if (isStopping || isWorking || isPrompting || options.verbose || !process.stderr.isTTY) return;

    const line = formatDaemonStatusLine({
      now: Date.now(),
      isPaused,
      nextCheckTime: Math.min(nextReviewCheckTime, nextAutoworkCheckTime),
      lastOpenPRCount,
      pendingRoutine,
      columns: process.stderr.columns,
    });

    process.stderr.write(`\r\x1b[K${line}`);
  };

  const handleStop = async () => {
    if (isStopping) return;
    isStopping = true;
    process.removeListener('SIGINT', handleStop);
    process.removeListener('SIGTERM', handleStop);
    keyboard?.stop();
    if (tickerInterval) {
      clearInterval(tickerInterval);
      tickerInterval = undefined;
    }
    clearTicker();
    console.log(pc.yellow(`\nStopping local agent daemon...`));
    clearDaemonState(repoRoot);
    await cleanupStaleWorktrees(repoRoot);
    stopResolve?.();
    process.exit(0);
  };

  process.once('SIGINT', handleStop);
  process.once('SIGTERM', handleStop);

  const performReviewDrain = async (): Promise<void> => {
    if (isStopping || isWorking) return;
    try {
      isWorking = true;
      nextReviewCheckTime = Date.now() + reviewIntervalMs;
      await drainReviewQueue({
        repoRoot,
        state,
        options,
        isStopping: () => isStopping,
        clearTicker,
        getPRs: getPRsFn,
        runRoutine: runRoutineFn,
        failureCooldowns,
        onQuotaExhausted: handleQuotaPause,
        onQuotaDepleted: async () => {
          await handleStop();
        },
      });
      try {
        const prs = await getPRsFn(repoRoot);
        lastOpenPRCount = prs.length;
      } catch (err: any) {
        console.warn(pc.yellow(`⚠️  Failed to refresh open PR count: ${err?.message || err}`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error in peer-review drain pass: ${err.message}`));
    } finally {
      isWorking = false;
      state.status = isPaused ? 'paused' : 'idle';
      state.activeRoutine = undefined;
      state.activeTarget = undefined;
      writeDaemonState(repoRoot, state);
      if (quotaCooldownUntil && Date.now() < quotaCooldownUntil) {
        nextReviewCheckTime = quotaCooldownUntil;
      } else {
        nextReviewCheckTime = Date.now() + reviewIntervalMs;
      }
      updateTicker();

      if (isGracefulStopping) {
        await handleStop();
        return;
      }

      if (pendingRoutine && !isStopping) {
        const next = pendingRoutine;
        pendingRoutine = null;
        console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Executing queued routine: ${next}...`));
        try {
          if (next === 'peer-review') {
            await performReviewDrain();
          } else if (next === 'autowork') {
            await runAutoworkCheck();
          }
        } catch (err: any) {
          console.error(pc.red(`✗ Error executing queued routine ${next}: ${err.message}`));
        }
      }
    }
  };


  const runAutoworkCheck = async (): Promise<void> => {
    if (isStopping || isWorking || !routines.includes('autowork')) return;

    try {
      isWorking = true;
      nextAutoworkCheckTime = Date.now() + autoworkIntervalMs;

      await performAutoworkScan({
        repoRoot,
        state,
        options,
        isStopping: () => isStopping,
        clearTicker,
        getPRs: getPRsFn,
        getBacklog: options.getBacklog || getBacklogTriageReport,
        runRoutine: runRoutineFn,
        failureCooldowns,
        onQuotaExhausted: handleQuotaPause,
        onQuotaDepleted: async () => {
          await handleStop();
        },
      });

      try {
        const prs = await getPRsFn(repoRoot);
        lastOpenPRCount = prs.length;
      } catch (err: any) {
        console.warn(pc.yellow(`⚠️  Failed to refresh open PR count: ${err?.message || err}`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error in autowork: ${err.message}`));
    } finally {
      isWorking = false;
      state.status = isPaused ? 'paused' : 'idle';
      state.activeRoutine = undefined;
      state.activeTarget = undefined;
      writeDaemonState(repoRoot, state);
      if (quotaCooldownUntil && Date.now() < quotaCooldownUntil) {
        nextAutoworkCheckTime = quotaCooldownUntil;
      } else {
        nextAutoworkCheckTime = Date.now() + autoworkIntervalMs;
      }
      updateTicker();

      // Immediate post-autowork convergence sweep: if autowork opened/readied a PR, drain it immediately!
      if (!isStopping && routines.includes('peer-review')) {
        try {
          const newPRCount = (await getPRsFn(repoRoot)).length;
          if (newPRCount > 0) {
            console.log(
              pc.cyan(
                `\n[${new Date().toLocaleTimeString()}] 🔄 Post-autowork convergence: Found ${newPRCount} ready PR(s). Initiating review sweep...`
              )
            );
            await performReviewDrain();
          }
        } catch (err: any) {
          console.error(pc.red(`✗ Error in post-autowork convergence review: ${err.message}`));
        }
      }

      if (isGracefulStopping) {
        await handleStop();
        return;
      }

      if (pendingRoutine && !isStopping) {
        const next = pendingRoutine;
        pendingRoutine = null;
        console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Executing queued routine: ${next}...`));
        try {
          if (next === 'peer-review') {
            await performReviewDrain();
          } else if (next === 'autowork') {
            await runAutoworkCheck();
          }
        } catch (err: any) {
          console.error(pc.red(`✗ Error executing queued routine ${next}: ${err.message}`));
        }
      }
    }
  };


  const runTargetedReview = async (prNumber: number): Promise<void> => {
    if (isStopping || isWorking) return;

    const guard = await checkDaemonQuotaGuard(repoRoot, options, state);
    if (guard.shouldStop) {
      clearTicker();
      console.warn(
        pc.red(
          `\n🛑 Cannot start targeted review: Plan quota is below 20% (${guard.depletion?.message}).\n` +
            `   Press 'b' to toggle full-burn mode if you wish to proceed.`
        )
      );
      updateTicker();
      return;
    }

    try {
      isWorking = true;
      clearTicker();
      state.status = 'working';
      state.activeRoutine = 'peer-review';
      state.activeTarget = `PR #${prNumber}`;
      writeDaemonState(repoRoot, state);

      console.log(
        pc.cyan(`\n[${new Date().toLocaleTimeString()}] 🎯 Targeted Peer Review: Starting session on PR #${prNumber}...`)
      );
      await cleanupStaleWorktrees(repoRoot);

      const result = await runRoutineFn({
        targetDir: repoRoot,
        routine: 'peer-review',
        pr: prNumber,
        model: options.model,
        verbose: options.verbose,
        noWorktree: false,
        onTargetDetected: (target: string) => {
          state.activeTarget = target;
          writeDaemonState(repoRoot, state);
        },
      });

      if (result.planQuota) {
        const postGuard = await checkDaemonQuotaGuard(repoRoot, options, state, result.planQuota);
        if (postGuard.shouldStop) {
          clearTicker();
          console.warn(
            pc.red(
              `\n🛑 Daemon stopped after targeted review: Plan quota dropped below 20% (${postGuard.depletion?.message}).`
            )
          );
          await handleStop();
          return;
        }
      }

      if (result.success) {
        const outcome =
          (result as any).outcome ||
          detectPeerReviewOutcome({
            output: result.output,
            prNumber,
            repoRoot,
          });
        console.log(formatPeerReviewOutcomeMessage(`PR #${prNumber}`, outcome, 'Targeted'));
      } else {
        console.warn(pc.yellow(`⚠️  Targeted peer-review on PR #${prNumber} completed with code ${result.exitCode}.\n`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error in targeted peer-review: ${err.message}`));
    } finally {
      isWorking = false;
      state.status = isPaused ? 'paused' : 'idle';
      state.activeRoutine = undefined;
      state.activeTarget = undefined;
      writeDaemonState(repoRoot, state);
      updateTicker();

      if (isGracefulStopping) {
        await handleStop();
        return;
      }

      if (pendingRoutine && !isStopping) {
        const next = pendingRoutine;
        pendingRoutine = null;
        console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Executing queued routine: ${next}...`));
        try {
          if (next === 'peer-review') {
            await performReviewDrain();
          } else if (next === 'autowork') {
            await runAutoworkCheck();
          }
        } catch (err: any) {
          console.error(pc.red(`✗ Error executing queued routine ${next}: ${err.message}`));
        }
      }
    }
  };


  const runTargetedAutowork = async (issueNumber: number): Promise<void> => {
    if (isStopping || isWorking) return;

    const guard = await checkDaemonQuotaGuard(repoRoot, options, state);
    if (guard.shouldStop) {
      clearTicker();
      console.warn(
        pc.red(
          `\n🛑 Cannot start targeted autowork: Plan quota is below 20% (${guard.depletion?.message}).\n` +
            `   Press 'b' to toggle full-burn mode if you wish to proceed.`
        )
      );
      updateTicker();
      return;
    }

    try {
      isWorking = true;
      clearTicker();
      state.status = 'working';
      state.activeRoutine = 'autowork';
      state.activeTarget = `Issue #${issueNumber}`;
      writeDaemonState(repoRoot, state);

      console.log(
        pc.cyan(`\n[${new Date().toLocaleTimeString()}] 🎯 Targeted Autowork: Starting session on Issue #${issueNumber}...`)
      );
      await cleanupStaleWorktrees(repoRoot);

      const result = await runRoutineFn({
        targetDir: repoRoot,
        routine: 'autowork',
        issue: issueNumber,
        model: options.model,
        verbose: options.verbose,
        noWorktree: false,
        onTargetDetected: (target: string) => {
          state.activeTarget = target;
          writeDaemonState(repoRoot, state);
        },
      });

      if (result.planQuota) {
        const postGuard = await checkDaemonQuotaGuard(repoRoot, options, state, result.planQuota);
        if (postGuard.shouldStop) {
          clearTicker();
          console.warn(
            pc.red(
              `\n🛑 Daemon stopped after targeted autowork: Plan quota dropped below 20% (${postGuard.depletion?.message}).`
            )
          );
          await handleStop();
          return;
        }
      }

      if (result.success) {
        console.log(pc.green(`✓ Targeted autowork on Issue #${issueNumber} completed successfully.\n`));
      } else {
        console.warn(pc.yellow(`⚠️  Targeted autowork on Issue #${issueNumber} completed with code ${result.exitCode}.\n`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error in targeted autowork: ${err.message}`));
    } finally {
      isWorking = false;
      state.status = isPaused ? 'paused' : 'idle';
      state.activeRoutine = undefined;
      state.activeTarget = undefined;
      writeDaemonState(repoRoot, state);
      updateTicker();

      // Immediate post-autowork convergence sweep
      if (!isStopping && routines.includes('peer-review')) {
        try {
          const newPRCount = (await getPRsFn(repoRoot)).length;
          if (newPRCount > 0) {
            console.log(
              pc.cyan(
                `\n[${new Date().toLocaleTimeString()}] 🔄 Post-autowork convergence: Found ${newPRCount} ready PR(s). Initiating review sweep...`
              )
            );
            await performReviewDrain();
          }
        } catch (err: any) {
          console.error(pc.red(`✗ Error in post-autowork convergence review: ${err.message}`));
        }
      }

      if (isGracefulStopping) {
        await handleStop();
        return;
      }

      if (pendingRoutine && !isStopping) {
        const next = pendingRoutine;
        pendingRoutine = null;
        console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Executing queued routine: ${next}...`));
        try {
          if (next === 'peer-review') {
            await performReviewDrain();
          } else if (next === 'autowork') {
            await runAutoworkCheck();
          }
        } catch (err: any) {
          console.error(pc.red(`✗ Error executing queued routine ${next}: ${err.message}`));
        }
      }
    }
  };


  // Keyboard Controller setup
  keyboard = new KeyboardController({
    stdin: options.stdin || process.stdin,
    onReview: async () => {
      if (isStopping || isGracefulStopping) return;
      if (isWorking) {
        pendingRoutine = 'peer-review';
        clearTicker();
        console.log(
          pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⏳ Peer Review scan queued (will run after current routine finishes).`)
        );
        updateTicker();
        return;
      }
      clearTicker();
      console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Triggering immediate Peer Review scan on demand...`));
      await performReviewDrain();
    },
    onAutowork: async () => {
      if (isStopping || isGracefulStopping) return;
      if (isWorking) {
        pendingRoutine = 'autowork';
        clearTicker();
        console.log(
          pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⏳ Autowork backlog scan queued (will run after current routine finishes).`)
        );
        updateTicker();
        return;
      }
      clearTicker();
      console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Triggering immediate Autowork scan on demand...`));
      await runAutoworkCheck();
    },
    onTargetedReview: async () => {
      if (isStopping || isGracefulStopping || isPrompting) return;
      if (isWorking) {
        clearTicker();
        console.log(
          pc.yellow(
            `\n[${new Date().toLocaleTimeString()}] ⚠️  Targeted review prompts require idle state. Use 'r' to queue a scan pass instead.`
          )
        );
        updateTicker();
        return;
      }

      clearTicker();
      keyboard?.pause();
      isPrompting = true;
      let rawInput: string | null = null;
      try {
        rawInput = await promptTargetedInput(`\n${pc.cyan('Enter PR # to review (Esc/Enter to cancel):')} `, {
          stdin: options.stdin || process.stdin,
          stdout: process.stdout,
        });
      } finally {
        isPrompting = false;
        keyboard?.resume();
      }

      if (!rawInput) {
        console.log(pc.dim(`[${new Date().toLocaleTimeString()}] Targeted review cancelled.\n`));
        updateTicker();
        return;
      }

      const prNumber = parseNumericTarget(rawInput);
      if (!prNumber) {
        console.log(
          pc.yellow(`[${new Date().toLocaleTimeString()}] ⚠️  Invalid PR number '${rawInput}'. Operation cancelled.\n`)
        );
        updateTicker();
        return;
      }

      await runTargetedReview(prNumber);
    },
    onTargetedAutowork: async () => {
      if (isStopping || isGracefulStopping || isPrompting) return;
      if (isWorking) {
        clearTicker();
        console.log(
          pc.yellow(
            `\n[${new Date().toLocaleTimeString()}] ⚠️  Targeted autowork prompts require idle state. Use 'a' to queue a scan pass instead.`
          )
        );
        updateTicker();
        return;
      }

      clearTicker();
      keyboard?.pause();
      isPrompting = true;
      let rawInput: string | null = null;
      try {
        rawInput = await promptTargetedInput(`\n${pc.cyan('Enter Issue # to work (Esc/Enter to cancel):')} `, {
          stdin: options.stdin || process.stdin,
          stdout: process.stdout,
        });
      } finally {
        isPrompting = false;
        keyboard?.resume();
      }

      if (!rawInput) {
        console.log(pc.dim(`[${new Date().toLocaleTimeString()}] Targeted autowork cancelled.\n`));
        updateTicker();
        return;
      }

      const issueNumber = parseNumericTarget(rawInput);
      if (!issueNumber) {
        console.log(
          pc.yellow(`[${new Date().toLocaleTimeString()}] ⚠️  Invalid Issue number '${rawInput}'. Operation cancelled.\n`)
        );
        updateTicker();
        return;
      }

      await runTargetedAutowork(issueNumber);
    },
    onToggleVerbose: () => {
      if (isStopping || isGracefulStopping) return;
      options.verbose = !options.verbose;
      clearTicker();
      if (options.verbose) {
        console.log(
          pc.green(`\n[${new Date().toLocaleTimeString()}] 🔊 Verbose mode ENABLED (streaming tokens directly to terminal).`)
        );
      } else {
        console.log(
          pc.yellow(`\n[${new Date().toLocaleTimeString()}] 🔇 Verbose mode DISABLED (compact terminal spinner active).`)
        );
      }
      updateTicker();
    },
    onToggleFullBurn: () => {
      if (isStopping || isGracefulStopping) return;
      options.fullBurn = !isFullBurnEnabled(options, state, repoRoot);
      if (state) {
        state.fullBurn = options.fullBurn;
        writeDaemonState(repoRoot, state);
      }
      clearTicker();
      if (options.fullBurn) {
        console.log(
          pc.red(`\n[${new Date().toLocaleTimeString()}] 🔥 Full burn mode ENABLED (ignoring <20% quota floor).`)
        );
      } else {
        console.log(
          pc.green(`\n[${new Date().toLocaleTimeString()}] 🛡️ Full burn mode DISABLED (daemon will stop if quota < 20%).`)
        );
      }
      updateTicker();
    },
    onTailLog: () => {
      if (isStopping || isGracefulStopping) return;
      clearTicker();
      printDaemonLogTail(repoRoot, 20);
      updateTicker();
    },
    onCleanWorktrees: async () => {
      if (isStopping || isGracefulStopping) return;
      clearTicker();
      const result = await inspectAndCleanWorktrees(repoRoot);
      printWorktreesInspection(result);
      updateTicker();
    },
    onPauseToggle: () => {
      if (isStopping || isGracefulStopping) return;
      isPaused = !isPaused;
      clearTicker();
      if (isPaused) {
        if (state.status !== 'working') state.status = 'paused';
        writeDaemonState(repoRoot, state);
        console.log(
          pc.yellow(
            `\n[${new Date().toLocaleTimeString()}] ⏸️  Daemon polling paused. Automatic interval sweeps suspended. (Press 'p' to resume)`
          )
        );
      } else {
        if (state.status !== 'working') state.status = 'idle';
        writeDaemonState(repoRoot, state);
        console.log(
          pc.green(`\n[${new Date().toLocaleTimeString()}] ▶️  Daemon polling resumed. Automated interval sweeps active.`)
        );
      }
      updateTicker();
    },
    onStatus: async () => {
      clearTicker();
      const activeWorktrees = await listActiveWorktrees(repoRoot);
      printDaemonStatusSummary({
        repoRoot,
        state,
        pendingRoutine,
        activeWorktrees,
        verbose: options.verbose,
      });
      updateTicker();
    },
    onGracefulStop: async () => {
      if (isStopping) return;
      pendingRoutine = null;
      if (isWorking) {
        isGracefulStopping = true;
        clearTicker();
        console.log(
          pc.yellow(
            `\n[${new Date().toLocaleTimeString()}] 🛑 Graceful stop requested. Waiting for active routine (${state.activeRoutine || 'routine'}) to complete before stopping...`
          )
        );
        return;
      }
      await handleStop();
    },
    onForceStop: async () => {
      await handleStop();
    },
    onHelp: () => {
      clearTicker();
      printKeybindingCheatSheet();
      updateTicker();
    },
  });

  keyboard?.start();

  // Reconcile any orphaned local routine issues left behind by host reboots/crashes non-blockingly
  void reconcileOrphanedLocalRuns(repoRoot).catch(() => {});

  // Run initial checks on start: drain review queue first, then move to autowork
  try {
    if (routines.includes('peer-review')) {
      await performReviewDrain();
    }
    if (!isStopping && !isGracefulStopping && routines.includes('autowork')) {
      await runAutoworkCheck();
    }
  } catch (err: any) {
    console.error(pc.red(`\n✗ Error during initial routine sweep: ${err.message}`));
  }

  if (isStopping) return;

  // Set up 1-second watchdog tick loop for decoupled intervals and ticker
  let isTicking = false;
  const tick = async () => {
    if (isStopping || isGracefulStopping || isWorking || isPrompting || isTicking) return;
    isTicking = true;

    try {
      if (!isPaused) {
        const tickGuard = await checkDaemonQuotaGuard(repoRoot, options, state);
        if (tickGuard.shouldStop) {
          clearTicker();
          console.warn(
            pc.red(
              `\n🛑 Daemon stopped by quota guard: Plan quota is below 20% (${tickGuard.depletion?.message}). Stopping daemon...`
            )
          );
          await handleStop();
          return;
        }

        const now = Date.now();
        if (routines.includes('peer-review') && now >= nextReviewCheckTime) {
          await performReviewDrain();
          return;
        }
        if (routines.includes('autowork') && now >= nextAutoworkCheckTime) {
          await runAutoworkCheck();
          return;
        }
      }

      updateTicker();
    } catch (err: any) {
      console.error(pc.red(`\n✗ Error during daemon watchdog tick: ${err.message}`));
    } finally {
      isTicking = false;
    }
  };


  tickerInterval = setInterval(tick, 1000);

  // Keep process alive
  await new Promise<void>((resolve) => {
    stopResolve = resolve;
  });
}
