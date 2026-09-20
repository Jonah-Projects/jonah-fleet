import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { createWorktree, removeWorktree } from './worktree.js';
import {
  TerminalSpinner,
  detectActivePhase,
  detectClaimedIssue,
  detectClaimedPR,
  formatActionDescription,
  cleanTargetTitle,
  formatTargetLabel,
  fetchTargetTitleAsync,
  renderSummaryCard,
  renderErrorCard,
  stripAnsi,
} from './terminal-card.js';
import {
  LoopGuard,
  formatLoopGuardFailureCard,
  formatLoopGuardReport,
  LoopGuardTrip,
} from './loop-guard.js';
import pc from 'picocolors';

export interface RunLocalRoutineOptions {
  targetDir: string;
  routine: string;
  issue?: string | number;
  pr?: string | number;
  title?: string;
  model?: string;
  printTimeout?: string;
  noWorktree?: boolean;
  keepWorktree?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  showCard?: boolean;
  env?: Record<string, string>;
  onLog?: (chunk: string) => void;
  onTargetDetected?: (target: string) => void;
}

export interface RunLocalRoutineResult {
  success: boolean;
  exitCode: number;
  output: string;
  stderr?: string;
  worktreePath?: string;
  branchName?: string;
  issueNumber?: number;
}

export interface StreamJsonEvent {
  event?: string;
  conversation_id?: string;
  init?: {
    cwd?: string;
    tools?: string[];
    permission_mode?: string;
  };
  step_update?: {
    conversation_id?: string;
    step_index?: number;
    state?: 'ACTIVE' | 'DONE' | 'ERROR' | string;
    step_type?: 'user_input' | 'agent_response' | 'tool' | 'thought' | string;
    tool_name?: string;
    tool_info?: {
      name?: string;
      parameters?: Record<string, any>;
      output?: string;
    };
    text_delta?: string;
    duration_seconds?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      total_tokens?: number;
    };
  };
  agent_response?: any;
  result?: {
    conversation_id?: string;
    status?: string;
    response?: string;
    duration_seconds?: number;
    num_turns?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      total_tokens?: number;
    };
  };
  [key: string]: any;
}

/**
 * Line buffer for incremental stream-json chunk processing.
 */
export class LineBufferedStreamParser {
  private buffer = '';
  private onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  public feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.onLine(trimmed);
      }
    }
  }

  public flush(): void {
    if (this.buffer.trim().length > 0) {
      this.onLine(this.buffer.trim());
      this.buffer = '';
    }
  }
}

/**
 * Safely parses a JSON event line from stream-json output.
 */
export function parseStreamJsonEvent(line: string): StreamJsonEvent | null {
  if (!line || !line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object') {
      return parsed as StreamJsonEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Formats stream-json events for verbose output.
 */
export function formatVerboseEvent(event: StreamJsonEvent): string | null {
  const time = new Date().toLocaleTimeString();

  if (event.event === 'init') {
    return `${pc.dim(`[${time}]`)} ${pc.cyan('[init]')} Session started (conversation: ${event.conversation_id || 'n/a'})`;
  }

  if (event.event === 'step_update' && event.step_update) {
    const su = event.step_update;

    if (su.step_type === 'user_input') {
      return `${pc.dim(`[${time}]`)} ${pc.magenta('[user_input]')} Prompt dispatched`;
    }

    if (su.step_type === 'tool') {
      const toolName = su.tool_name || su.tool_info?.name || 'tool';
      const params = su.tool_info?.parameters;

      if (su.state === 'ACTIVE') {
        const desc = formatActionDescription(toolName, params);
        return `${pc.dim(`[${time}]`)} ${pc.blue('[tool:start]')} ${pc.bold(toolName)} → ${desc}`;
      }
      if (su.state === 'DONE') {
        const dur = su.duration_seconds !== undefined ? `${su.duration_seconds.toFixed(1)}s` : 'done';
        return `${pc.dim(`[${time}]`)} ${pc.green('[tool:done]')} ${pc.bold(toolName)} (${dur})`;
      }
    }

    if (su.step_type === 'agent_response' || su.step_type === 'thought') {
      if (su.text_delta) {
        return su.text_delta;
      }
      if (su.state === 'DONE') {
        const dur = su.duration_seconds !== undefined ? ` (${su.duration_seconds.toFixed(1)}s)` : '';
        return `${pc.dim(`[${time}]`)} ${pc.cyan('[agent:step]')} Step ${su.step_index ?? 0} finished${dur}`;
      }
    }
  }

  if (event.event === 'result' && event.result) {
    const res = event.result;
    const dur = res.duration_seconds !== undefined ? `${res.duration_seconds.toFixed(1)}s` : '';
    const tokens = res.usage?.total_tokens ? `${res.usage.total_tokens.toLocaleString()} tokens` : '';
    const metrics = [dur, tokens].filter(Boolean).join(', ');
    return `${pc.dim(`[${time}]`)} ${pc.bold(pc.green('[result]'))} ${res.status || 'COMPLETED'} (${metrics || 'done'})`;
  }

  return null;
}

/**
 * Builds the invocation arguments for Antigravity CLI in stream-json mode.
 */
export function buildAgyArgs(prompt: string, model: string, printTimeout: string): string[] {
  return [
    '-p',
    prompt,
    '--model',
    model,
    '--output-format',
    'stream-json',
    '--print-timeout',
    printTimeout,
    '--dangerously-skip-permissions',
  ];
}

/**
 * Discovers domain skills in .agents/skills and formats instruction string.
 */
export function discoverSkillsPrompt(targetDir: string): string {
  const skillsDir = path.join(targetDir, '.agents', 'skills');
  if (!fs.existsSync(skillsDir)) return '';

  let skillsPrompt = '';
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join('.agents', 'skills', entry.name, 'SKILL.md');
        const fullPath = path.join(targetDir, skillPath);
        if (fs.existsSync(fullPath)) {
          skillsPrompt += `Read and follow ${skillPath}. `;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return skillsPrompt;
}

/**
 * Builds the prompt string for a given routine and target.
 */
export function buildRoutinePrompt(
  targetDir: string,
  routine: string,
  options: { issue?: string | number; pr?: string | number; routineIssueNumber?: number } = {}
): string {
  const skillsPrompt = discoverSkillsPrompt(targetDir);
  const promptFile = `.github/prompts/${routine}.md`;
  const repoContext = `Working repository is located at ${targetDir}. All git, gh, and workspace commands must execute strictly within this repository.`;
  const logPrompt = options.routineIssueNumber
    ? ` Tracking run log issue: #${options.routineIssueNumber}.`
    : '';
  const headlessGuardrail = ` Execution Guardrail: You are executing in a headless autonomous session. You MUST NEVER call schedule or yield your turn with plain text to wait on background tasks or verification checks. If a verification command (tests, type-check, lint) runs in the background, inspect its completion with manage_task(Action='status') or manage_subagents(Action='list') (status polling with these tools is explicitly exempted from loop guard circuit breakers), or execute commands with sufficient WaitMsBeforeAsync (up to 10000 ms). DO NOT busy-wait by repeatedly calling read tools (such as view_file) on unchanged files to pass time while waiting, as calling non-polling tools with identical parameters will trip the loop circuit breaker. Never stop calling tools or yield your turn until the routine's terminal Definition of Done is fully reached.`;

  if (routine === 'autowork') {
    if (options.issue) {
      return `You are the Autowork routine for this repository. ${repoContext} Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}Your target is issue #${options.issue}. You are in Targeted mode: work issue #${options.issue} directly, ahead of Phase 1 convergence and priority scan.${logPrompt}${headlessGuardrail}`;
    }
    return `You are the Autowork routine for this repository. ${repoContext} Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}You are in Scan mode: check open PRs for review comments to fix, close merged issues, then pick the highest-priority unclaimed issue.${logPrompt}${headlessGuardrail}`;
  }

  if (routine === 'peer-review') {
    if (options.pr) {
      return `You are the Peer Review routine for this repository. ${repoContext} Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}Your target is pull request #${options.pr}. You are in Targeted mode: review PR #${options.pr} directly.${logPrompt}${headlessGuardrail}`;
    }
    return `You are the Peer Review routine for this repository. ${repoContext} Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}You are in Scan mode: check open PRs and select the highest-priority PR to review.${logPrompt}${headlessGuardrail}`;
  }

  return `You are the ${routine} routine for this repository. ${repoContext} Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}${logPrompt}${headlessGuardrail}`;
}

/**
 * Checks if Antigravity CLI (`agy`) is installed and accessible.
 */
export function isAgyInstalled(): boolean {
  try {
    execSync('agy --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempts to initialize a GitHub issue for local routine execution (runner:local).
 * Fails gracefully if offline or unauthenticated.
 */
export function tryCreateLocalRunIssue(
  cwd: string,
  routine: string,
  timestamp: string,
  targetLabel: string,
  hostname: string
): number | undefined {
  try {
    const title = `[${routine}] run ${timestamp} (local)`;
    const body = `### Autonomous Routine Execution in Progress (runner:local)\n- **Routine**: \`${routine}\`\n- **Timestamp**: \`${timestamp}\`\n- **Target**: \`${targetLabel}\`\n- **Host**: \`${hostname}\`\n\n_Running via Jonah Fleet CLI runner._`;
    const labels = `routine-log,routine:${routine},status:running,runner:local`;
    const out = execSync(`gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label ${JSON.stringify(labels)}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = out.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}

export interface MilestoneCardOptions {
  emoji?: string;
  milestoneTitle: string;
  phase: string;
  status: string;
  targetOrContext: string;
  keyDecisionOrFinding: string;
  next: string;
}

/**
 * Formats a compact milestone card conforming to the 5-point schema.
 */
export function formatMilestoneCard(options: MilestoneCardOptions): string {
  const emoji = options.emoji || '🧭';
  return [
    `### ${emoji} Milestone: ${options.milestoneTitle}`,
    `- **Phase**: \`${options.phase}\``,
    `- **Status**: ${options.status}`,
    `- **Target / Context**: \`${options.targetOrContext}\``,
    `- **Key Decision / Finding**: ${options.keyDecisionOrFinding}`,
    `- **Next**: ${options.next}`,
  ].join('\n');
}

export interface InterruptionCardOptions {
  routine: string;
  status: string;
  step?: string;
  logUrl?: string;
  runner?: string;
}

/**
 * Formats an interruption card for failed/interrupted routine runs.
 */
export function formatInterruptionCard(options: InterruptionCardOptions): string {
  const lines = [
    `### ❌ Milestone: Run Interrupted / Failed`,
    `- **Routine**: \`${options.routine}\``,
    `- **Status**: Routine execution interrupted or failed (\`${options.status}\`)`,
    `- **Step**: ${options.step || 'Execution halted before normal completion'}`,
  ];
  if (options.logUrl) {
    lines.push(`- **Action Log**: [View Run Logs](${options.logUrl})`);
  } else if (options.runner) {
    lines.push(`- **Runner**: \`${options.runner}\``);
  }
  return lines.join('\n');
}

/**
 * Posts a milestone comment to a local routine tracking issue.
 * Fails gracefully if offline or unauthenticated.
 */
export function tryPostLocalRunMilestone(
  cwd: string,
  issueNumber: number,
  cardContent: string
): void {
  try {
    const tmpFile = path.join(os.tmpdir(), `jonah-fleet-milestone-${issueNumber}-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, cardContent, 'utf8');
    try {
      execSync(`gh issue comment ${issueNumber} --body-file ${JSON.stringify(tmpFile)}`, {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  } catch {
    // Ignore offline or auth failures during milestone posting
  }
}

/**
 * Posts a milestone comment to a local routine tracking issue asynchronously.
 * Fails gracefully if offline or unauthenticated.
 */
export async function tryPostLocalRunMilestoneAsync(
  cwd: string,
  issueNumber: number,
  cardContent: string
): Promise<boolean> {
  const tmpFile = path.join(os.tmpdir(), `jonah-fleet-milestone-${issueNumber}-${Date.now()}.md`);
  try {
    await fs.promises.writeFile(tmpFile, cardContent, 'utf8');
    await execFileAsync('gh', ['issue', 'comment', String(issueNumber), '--body-file', tmpFile], {
      cwd,
    });
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (fs.existsSync(tmpFile)) {
        await fs.promises.unlink(tmpFile);
      }
    } catch {}
  }
}

export interface QuotaDetectionResult {
  isQuota: boolean;
  resetInfo?: string;
}

/**
 * Detects whether routine runner stdout/stderr failed due to LLM quota exhaustion.
 */
export function detectQuotaExceeded(output: string, stderr: string): QuotaDetectionResult {
  const combined = `${output}\n${stderr}`;
  if (/individual quota reached|quota reached/i.test(combined)) {
    const match = combined.match(/Resets in ([^.\n]+)/i);
    return {
      isQuota: true,
      resetInfo: match ? `Resets in ${match[1].trim()}` : undefined,
    };
  }
  return { isQuota: false };
}

/**
 * Reconciles a GitHub issue for local routine execution.
 * Closes the issue if success, leaves it open with needs-attention if failure.
 * Handles quota-paused routines gracefully without marking as failure.
 * Fails gracefully if offline or unauthenticated.
 */
export function tryReconcileLocalRunIssue(
  cwd: string,
  issueNumber: number,
  reportContent: string,
  exitCode: number,
  hostname: string,
  routine?: string,
  quotaInfo?: QuotaDetectionResult
): void {
  try {
    if (quotaInfo?.isQuota) {
      const resetStr = quotaInfo.resetInfo || 'Resets in future window';
      const quotaCard = [
        `### ⏸️ Milestone: Routine Execution Quota-Paused`,
        `- **Routine**: \`${routine || 'local-routine'}\``,
        `- **Status**: LLM quota reached (\`${resetStr}\`)`,
        `- **Runner**: \`local (${hostname})\``,
        `- **Next Action**: Routine execution paused cleanly. Work will resume on next sweep after quota resets.`,
      ].join('\n');
      tryPostLocalRunMilestone(cwd, issueNumber, quotaCard);

      const finalBody = `${reportContent}\n\n---\n_Generated by Jonah Fleet local runner on ${hostname}._`;
      const tmpFile = path.join(os.tmpdir(), `jonah-fleet-run-${issueNumber}-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, finalBody, 'utf8');
      try {
        execSync(`gh issue edit ${issueNumber} --body-file ${JSON.stringify(tmpFile)}`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        execSync(`gh issue edit ${issueNumber} --add-label "status:quota-paused" --remove-label "status:running"`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        execSync(`gh issue close ${issueNumber} --reason completed`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
      return;
    }

    if (exitCode !== 0) {
      const interruptionCard = formatInterruptionCard({
        routine: routine || 'local-routine',
        status: `exit code ${exitCode}`,
        runner: `local (${hostname})`,
      });
      tryPostLocalRunMilestone(cwd, issueNumber, interruptionCard);
    }

    const finalBody = `${reportContent}\n\n---\n_Generated by Jonah Fleet local runner on ${hostname}._`;
    const tmpFile = path.join(os.tmpdir(), `jonah-fleet-run-${issueNumber}-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, finalBody, 'utf8');
    try {
      execSync(`gh issue edit ${issueNumber} --body-file ${JSON.stringify(tmpFile)}`, {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      if (exitCode === 0) {
        execSync(`gh issue edit ${issueNumber} --add-label "status:success" --remove-label "status:running"`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        execSync(`gh issue close ${issueNumber} --reason completed`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } else {
        execSync(`gh issue edit ${issueNumber} --add-label "status:failure,needs-attention" --remove-label "status:running"`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      }
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  } catch {
    // Ignore offline or auth failures during issue reconciliation
  }
}

/**
 * Asynchronously marks an interrupted local routine run as failed and posts an interruption card.
 * Leaves the issue open with status:failure,needs-attention for maintainer triage.
 * Fails gracefully if offline or unauthenticated.
 */
export async function tryMarkLocalRunInterruptedAsync(
  cwd: string,
  issueNumber: number,
  hostname: string,
  reason: string = 'Host machine process terminated mid-execution (machine reboot or SIGKILL)',
  routine: string = 'local-routine'
): Promise<boolean> {
  try {
    const interruptionCard = formatInterruptionCard({
      routine,
      status: reason,
      runner: `local (${hostname})`,
      step: 'Local execution interrupted before completion',
    });
    await tryPostLocalRunMilestoneAsync(cwd, issueNumber, interruptionCard);
    await execFileAsync(
      'gh',
      ['issue', 'edit', String(issueNumber), '--add-label', 'status:failure,needs-attention', '--remove-label', 'status:running'],
      { cwd }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Asynchronously reconciles a GitHub issue for local routine execution.
 * Closes the issue if success, leaves it open with needs-attention if failure.
 * Fails gracefully if offline or unauthenticated.
 */
export async function tryReconcileLocalRunIssueAsync(
  cwd: string,
  issueNumber: number,
  reportContent: string,
  exitCode: number,
  hostname: string,
  routine?: string
): Promise<boolean> {
  try {
    if (exitCode !== 0) {
      const interruptionCard = formatInterruptionCard({
        routine: routine || 'local-routine',
        status: `exit code ${exitCode}`,
        runner: `local (${hostname})`,
      });
      await tryPostLocalRunMilestoneAsync(cwd, issueNumber, interruptionCard);
    }

    const finalBody = `${reportContent}\n\n---\n_Generated by Jonah Fleet local runner on ${hostname}._`;
    const tmpFile = path.join(os.tmpdir(), `jonah-fleet-run-${issueNumber}-${Date.now()}.md`);
    await fs.promises.writeFile(tmpFile, finalBody, 'utf8');
    try {
      await execFileAsync('gh', ['issue', 'edit', String(issueNumber), '--body-file', tmpFile], {
        cwd,
      });
      if (exitCode === 0) {
        await execFileAsync(
          'gh',
          ['issue', 'edit', String(issueNumber), '--add-label', 'status:success', '--remove-label', 'status:running'],
          { cwd }
        );
        await execFileAsync(
          'gh',
          ['issue', 'close', String(issueNumber), '--reason', 'completed'],
          { cwd }
        );
      } else {
        await execFileAsync(
          'gh',
          ['issue', 'edit', String(issueNumber), '--add-label', 'status:failure,needs-attention', '--remove-label', 'status:running'],
          { cwd }
        );
      }
      return true;
    } finally {
      try {
        if (fs.existsSync(tmpFile)) {
          await fs.promises.unlink(tmpFile);
        }
      } catch {}
    }
  } catch {
    return false;
  }
}

/**
 * Reads a freshly generated run report from execution or target directory.
 * Returns null if no fresh report exists (e.g. file missing or older than run start).
 */
export function extractFreshRunReport(
  executionReportPath: string,
  targetReportPath: string,
  startTime: number
): string | null {
  try {
    if (fs.existsSync(executionReportPath)) {
      const stat = fs.statSync(executionReportPath);
      if (stat.mtimeMs >= startTime - 1000) {
        return fs.readFileSync(executionReportPath, 'utf8');
      }
    }
  } catch {}

  try {
    if (executionReportPath !== targetReportPath && fs.existsSync(targetReportPath)) {
      const stat = fs.statSync(targetReportPath);
      if (stat.mtimeMs >= startTime - 1000) {
        return fs.readFileSync(targetReportPath, 'utf8');
      }
    }
  } catch {}

  return null;
}

export interface FallbackReportOptions {
  routine: string;
  timestamp: string;
  exitCode: number;
  hostname: string;
  targetLabel: string;
  durationSec: number;
  output?: string;
  stderr?: string;
}

/**
 * Resolves child process exit code, ensuring signals (e.g. SIGTERM, SIGINT)
 * resolve to a non-zero exit code instead of defaulting to 0.
 */
export function resolveExitCode(code: number | null, signal: NodeJS.Signals | string | null): number {
  return code ?? (signal ? 1 : 0);
}

/**
 * Detects whether an autonomous routine exited prematurely (e.g. agent yielded its
 * turn to "wait" on background tasks or timers, which causes headless agy -p to terminate
 * with exit code 0 before reaching the routine's Definition of Done).
 */
export function detectPrematureRoutineExit(output: string, routine: string): string | null {
  if (!output) return null;

  // Check for common premature turn-yielding phrases
  const prematureYieldPatterns = [
    /verification is in progress/i,
    /waiting for .* to (?:finish|complete)/i,
    /waiting for (?:test|type-check|check|task)/i,
    /check if .* finished/i,
    /task-.* is running/i,
  ];

  for (const pattern of prematureYieldPatterns) {
    if (pattern.test(output)) {
      // Check if there was actually a subsequent completion / final report
      const terminalSuccessPatterns = [
        /## (?:Run Summary|Execution Report)/i,
        /Milestone: Run Completed/i,
        /Squash-merged/i,
        /Merged PR/i,
        /converted .* to draft/i,
        /bounced .* to draft/i,
        /No PRs to review/i,
      ];
      const hasTerminalSuccess = terminalSuccessPatterns.some((p) => p.test(output));
      if (!hasTerminalSuccess) {
        return 'Premature session termination: Agent yielded turn on background task before reaching Definition of Done.';
      }
    }
  }

  // Peer review specific guardrail: if started reviewing a PR, must take a terminal action
  if (routine === 'peer-review') {
    const startedReview = /Starting review/i.test(output);
    if (startedReview) {
      const terminalActionTaken =
        /Squash-merged/i.test(output) ||
        /Merged PR/i.test(output) ||
        /--undo/i.test(output) ||
        /converted .* to draft/i.test(output) ||
        /bounced .* to draft/i.test(output) ||
        /needs-human/i.test(output) ||
        /escalat/i.test(output) ||
        /Milestone: Run Completed/i.test(output) ||
        /Review completed with decision/i.test(output) ||
        /No PRs to review/i.test(output);

      if (!terminalActionTaken) {
        return 'Premature peer-review termination: Review was started but agent exited without executing terminal action (merge, draft bounce, or escalation).';
      }
    }
  }

  return null;
}

/**
 * Formats a fallback summary markdown report when no fresh run-report.md was generated.
 * Includes sanitized trailing error output from stdout and/or stderr if exitCode is non-zero.
 */
export function formatFallbackRunReport(options: FallbackReportOptions): string {
  const result = options.exitCode === 0 ? 'SUCCESS' : 'FAILURE';
  let reportContent = `## Run Summary\n\n| Metric | Value |\n|---|---|\n| Routine | \`${options.routine}\` |\n| Timestamp | \`${options.timestamp}\` |\n| Result | \`${result}\` |\n| Exit Code | \`${options.exitCode}\` |\n| Host | \`${options.hostname}\` |\n| Target | \`${options.targetLabel}\` |\n| Duration | \`${options.durationSec}s\` |\n`;

  if (options.exitCode !== 0) {
    const errorChunks = [options.output?.trim(), options.stderr?.trim()].filter(Boolean);
    const combinedError = errorChunks.join('\n');
    if (combinedError.trim()) {
      const sanitizedOutput = stripAnsi(combinedError.trim()).split('\n').slice(-15).join('\n');
      reportContent += `\n### Error Output\n\n\`\`\`\n${sanitizedOutput}\n\`\`\`\n`;
    }
  }

  return reportContent;
}

/**
 * Runs a routine locally with worktree isolation and Antigravity CLI invocation.
 */
export async function runLocalRoutine(options: RunLocalRoutineOptions): Promise<RunLocalRoutineResult> {
  const targetDir = path.resolve(options.targetDir);
  const routine = options.routine;
  const model = options.model || 'gemini-3.8-flash-high';
  const printTimeout = options.printTimeout || '30m';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const hostname = os.hostname();

  // Validate prompt file existence
  const promptFile = path.join(targetDir, '.github', 'prompts', `${routine}.md`);
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Routine prompt file not found: ${promptFile}`);
  }

  // Generate branch name
  let branchName = `agent/${routine}-${timestamp}`;
  if (options.issue) {
    branchName = `agent/${routine}-issue-${options.issue}-${timestamp}`;
  } else if (options.pr) {
    branchName = `agent/${routine}-pr-${options.pr}-${timestamp}`;
  }

  let worktreePath: string | undefined;
  let executionDir = targetDir;

  if (!options.noWorktree && !options.dryRun) {
    const worktreeResult = await createWorktree(targetDir, { branchName });
    worktreePath = worktreeResult.worktreePath;
    executionDir = worktreePath;
  }

  let targetTitle: string | undefined = options.title;
  const baseTarget = options.pr
    ? `PR #${options.pr}`
    : options.issue
      ? `Issue #${options.issue}`
      : undefined;

  let targetLabel = baseTarget
    ? formatTargetLabel(baseTarget, targetTitle)
    : routine;
  let dynamicTargetDetected = Boolean(options.pr || options.issue);

  let routineIssueNumber: number | undefined;
  if (!options.dryRun) {
    routineIssueNumber = tryCreateLocalRunIssue(targetDir, routine, timestamp, targetLabel, hostname);
  }

  const prompt = buildRoutinePrompt(executionDir, routine, {
    issue: options.issue,
    pr: options.pr,
    routineIssueNumber,
  });

  if (options.dryRun) {
    return {
      success: true,
      exitCode: 0,
      output: `[DRY RUN] Would execute routine '${routine}' in ${options.noWorktree ? 'current directory' : 'worktree'}:\nPrompt: ${prompt}\nModel: ${model}\nTimeout: ${printTimeout}`,
      worktreePath,
      branchName,
    };
  }

  // Prepare environment
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    LOCAL_AGENT: 'true',
    LOCAL_HOST: hostname,
    TARGET_ISSUE: options.issue ? String(options.issue) : '',
    PR_NUMBER: options.pr ? String(options.pr) : '',
  };

  if (routineIssueNumber) {
    childEnv.ROUTINE_ISSUE_NUMBER = String(routineIssueNumber);
  }

  const args = buildAgyArgs(prompt, model, printTimeout);

  let output = '';
  let finalResponseText = '';
  let accumulatedOutput = '';
  let exitCode = 0;
  const startTime = Date.now();

  const logDir = path.join(targetDir, '.jonah-fleet');
  fs.mkdirSync(logDir, { recursive: true });
  const logFilePath = path.join(logDir, 'daemon.log');
  const runsDir = path.join(logDir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  // Remove preexisting run-report.md in executionDir and targetDir before routine starts
  // to guarantee stale reports from previous runs cannot leak into this run's summary or tracking issue
  const executionReportPath = path.join(executionDir, '.jonah-fleet', 'run-report.md');
  const targetReportPath = path.join(targetDir, '.jonah-fleet', 'run-report.md');
  try {
    if (fs.existsSync(executionReportPath)) {
      fs.unlinkSync(executionReportPath);
    }
  } catch {}
  try {
    if (fs.existsSync(targetReportPath)) {
      fs.unlinkSync(targetReportPath);
    }
  } catch {}

  let activePhase = 'Starting session...';
  let lastActionDesc: string | null = null;
  const spinner = !options.verbose ? new TerminalSpinner() : null;
  if (spinner) {
    spinner.start(`${targetLabel}: ${activePhase}`);
  }

  // If target was supplied via options but without a title, fetch title in background
  if (baseTarget && !targetTitle) {
    fetchTargetTitleAsync(targetDir, baseTarget)
      .then((fetchedTitle) => {
        if (fetchedTitle && !targetTitle) {
          targetTitle = fetchedTitle;
          targetLabel = formatTargetLabel(baseTarget, targetTitle);
          options.onTargetDetected?.(targetLabel);
          if (spinner) {
            spinner.update(`${targetLabel}: ${lastActionDesc || activePhase}`);
          }
        }
      })
      .catch(() => {});
  }

  // Cleanup handler on process interruption
  const cleanup = async () => {
    spinner?.stop();
    if (worktreePath && !options.keepWorktree) {
      await removeWorktree(targetDir, worktreePath, { deleteBranch: false }).catch(() => {});
    }
  };

  const sigintHandler = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigintHandler);

  const checkTargetDetection = (text: string) => {
    if (dynamicTargetDetected || !text) return;
    const detected =
      routine === 'peer-review' ? detectClaimedPR(text) : detectClaimedIssue(text);
    if (detected) {
      dynamicTargetDetected = true;
      targetLabel = detected;
      options.onTargetDetected?.(detected);
      if (spinner) {
        spinner.update(`${targetLabel}: ${lastActionDesc || activePhase}`);
      }

      fetchTargetTitleAsync(executionDir, detected)
        .then((fetchedTitle) => {
          if (fetchedTitle) {
            targetTitle = fetchedTitle;
            targetLabel = formatTargetLabel(detected, fetchedTitle);
            options.onTargetDetected?.(targetLabel);
            if (spinner) {
              spinner.update(`${targetLabel}: ${lastActionDesc || activePhase}`);
            }
          }
        })
        .catch(() => {});
    }
  };

  let loopGuardTrip: LoopGuardTrip | null = null;
  let activeChild: any = null;

  const loopGuard = new LoopGuard({
    repetitionThreshold: 5,
    pingPongThreshold: 3,
    consecutiveErrorThreshold: 2,
    slidingWindowSize: 20,
    onTrip: (trip) => {
      loopGuardTrip = trip;
      spinner?.stop();
      if (activeChild && !activeChild.killed) {
        try {
          activeChild.kill('SIGTERM');
        } catch {}
        const killTimer = setTimeout(() => {
          try {
            if (activeChild && !activeChild.killed) {
              activeChild.kill('SIGKILL');
            }
          } catch {}
        }, 3000);
        killTimer.unref();
      }
    },
  });

  const stdoutParser = new LineBufferedStreamParser((line: string) => {
    const event = parseStreamJsonEvent(line);
    if (event) {
      if (event.event === 'step_update' && event.step_update) {
        const su = event.step_update;

        if (su.step_type === 'tool') {
          const toolName = su.tool_name || su.tool_info?.name || 'unknown';
          const toolParams = su.tool_info?.parameters;

          if (su.state === 'ACTIVE') {
            loopGuard.recordAction(toolName, toolParams, false);
            const actionDesc = formatActionDescription(toolName, toolParams);
            lastActionDesc = actionDesc;
            if (spinner) {
              spinner.update(`${targetLabel}: ${actionDesc}`);
            }
            if (toolParams?.CommandLine) {
              checkTargetDetection(toolParams.CommandLine);
            }
            if (options.verbose) {
              const formatted = formatVerboseEvent(event);
              if (formatted) console.log(formatted);
            }
          } else if (su.state === 'ERROR') {
            loopGuard.recordAction(toolName, toolParams, true);
            lastActionDesc = null;
          } else if (su.state === 'DONE') {
            lastActionDesc = null;
            if (su.tool_info?.output) {
              checkTargetDetection(su.tool_info.output);
            }
            if (spinner) {
              activePhase = 'Evaluating tool output...';
              spinner.update(`${targetLabel}: ${activePhase}`);
            }
            if (options.verbose) {
              const formatted = formatVerboseEvent(event);
              if (formatted) console.log(formatted);
            }
          }
        } else if (su.step_type === 'agent_response' || su.step_type === 'thought') {
          if (su.text_delta) {
            accumulatedOutput += su.text_delta;
            checkTargetDetection(su.text_delta);
            const newPhase = detectActivePhase(su.text_delta, activePhase);
            if (newPhase !== activePhase || lastActionDesc) {
              lastActionDesc = null;
              activePhase = newPhase;
              if (spinner) {
                spinner.update(`${targetLabel}: ${activePhase}`);
              }
            }
            if (options.verbose) {
              process.stdout.write(su.text_delta);
            }
          } else if (options.verbose && su.state === 'DONE') {
            const formatted = formatVerboseEvent(event);
            if (formatted) console.log(formatted);
          }
        } else if (options.verbose) {
          const formatted = formatVerboseEvent(event);
          if (formatted) console.log(formatted);
        }
      } else if (event.event === 'result' && event.result) {
        if (event.result.response) {
          finalResponseText = event.result.response;
          checkTargetDetection(event.result.response);
        }
        if (options.verbose) {
          const formatted = formatVerboseEvent(event);
          if (formatted) console.log(formatted);
        }
      } else if (event.event === 'init') {
        if (options.verbose) {
          const formatted = formatVerboseEvent(event);
          if (formatted) console.log(formatted);
        }
      }
    } else {
      // Non-JSON line from stdout
      accumulatedOutput += line + '\n';
      checkTargetDetection(line);
      if (options.verbose) {
        console.log(line);
      } else if (spinner) {
        lastActionDesc = null;
        const newPhase = detectActivePhase(line, activePhase);
        if (newPhase !== activePhase) {
          activePhase = newPhase;
          spinner.update(`${targetLabel}: ${activePhase}`);
        }
      }
    }
  });

  let accumulatedStderr = '';

  const stderrParser = new LineBufferedStreamParser((line: string) => {
    accumulatedStderr += line + '\n';
    checkTargetDetection(line);
    if (options.verbose) {
      console.error(pc.dim(`[stderr] ${line}`));
    } else if (spinner) {
      lastActionDesc = null;
      const newPhase = detectActivePhase(line, activePhase);
      if (newPhase !== activePhase) {
        activePhase = newPhase;
        spinner.update(`${targetLabel}: ${activePhase}`);
      }
    }
  });

  const processChunk = (chunk: string, isStderr: boolean = false) => {
    try {
      fs.appendFileSync(logFilePath, chunk, 'utf8');
    } catch {
      // Ignore log write errors
    }

    if (options.onLog) {
      options.onLog(chunk);
    }

    if (isStderr) {
      stderrParser.feed(chunk);
    } else {
      stdoutParser.feed(chunk);
    }
  };

  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('agy', args, {
        cwd: executionDir,
        env: childEnv,
        stdio: ['inherit', 'pipe', 'pipe'],
      });
      activeChild = child;

      child.stdout?.on('data', (data) => {
        processChunk(data.toString(), false);
      });

      child.stderr?.on('data', (data) => {
        processChunk(data.toString(), true);
      });

      child.on('error', (err) => {
        spinner?.stop();
        reject(err);
      });

      child.on('close', (code, signal) => {
        spinner?.stop();
        resolve(resolveExitCode(code, signal));
      });
    });
  } finally {
    spinner?.stop();
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigintHandler);
    if (!options.keepWorktree) {
      await cleanup();
    }
  }

  stdoutParser.flush();
  stderrParser.flush();
  output = finalResponseText || accumulatedOutput;

  const durationMs = Date.now() - startTime;
  const durationSec = Math.round(durationMs / 1000);

  // Check for freshly generated .jonah-fleet/run-report.md (in executionDir or targetDir)
  let reportContent = extractFreshRunReport(executionReportPath, targetReportPath, startTime) || '';

  let prematureError: string | null = null;
  if (exitCode === 0 && !reportContent) {
    prematureError = detectPrematureRoutineExit(output, routine);
    if (prematureError) {
      exitCode = 1;
    }
  }

  if (loopGuardTrip) {
    exitCode = 1;
    reportContent = formatLoopGuardReport({
      routine,
      timestamp,
      trip: loopGuardTrip,
    });
    try {
      fs.writeFileSync(executionReportPath, reportContent, 'utf8');
      fs.writeFileSync(targetReportPath, reportContent, 'utf8');
    } catch {}

    if (routineIssueNumber) {
      const failureCard = formatLoopGuardFailureCard({
        routine,
        trip: loopGuardTrip,
      });
      tryPostLocalRunMilestone(targetDir, routineIssueNumber, failureCard);
    }
  } else if (!reportContent) {
    reportContent = formatFallbackRunReport({
      routine,
      timestamp,
      exitCode,
      hostname,
      targetLabel,
      durationSec,
      output,
      stderr: [accumulatedStderr, prematureError].filter(Boolean).join('\n'),
    });
  }

  // Ensure report is copied to targetDir/.jonah-fleet/run-report.md
  try {
    fs.writeFileSync(targetReportPath, reportContent, 'utf8');
  } catch {}

  // Save run history to .jonah-fleet/runs/
  const runReportFile = path.join(runsDir, `${routine}-${timestamp}.md`);
  const runMetaFile = path.join(runsDir, `${routine}-${timestamp}.json`);
  try {
    fs.writeFileSync(runReportFile, reportContent, 'utf8');
    fs.writeFileSync(
      runMetaFile,
      JSON.stringify(
        {
          routine,
          timestamp,
          exitCode,
          success: exitCode === 0,
          target: targetLabel,
          issueNumber: routineIssueNumber,
          durationMs,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {}

  // Reconcile GitHub issue if one was created
  const quotaInfo = detectQuotaExceeded(output, accumulatedStderr);
  if (routineIssueNumber) {
    tryReconcileLocalRunIssue(targetDir, routineIssueNumber, reportContent, exitCode, hostname, routine, quotaInfo);
  }

  // Render Card if not in verbose mode and showCard is not disabled
  if (options.showCard !== false && !options.verbose) {
    const prMatch = targetLabel.match(/PR\s*#?(\d+)/i);
    const issueMatch = targetLabel.match(/Issue\s*#?(\d+)/i);
    const effectiveIssue =
      options.issue || (issueMatch ? issueMatch[1] : undefined);
    const effectivePR =
      options.pr || (prMatch ? prMatch[1] : undefined);

    if (exitCode === 0) {
      console.log(
        '\n' +
          renderSummaryCard({
            routine,
            output,
            repoRoot: targetDir,
            issue: effectiveIssue,
            pr: effectivePR,
            title: targetTitle,
            durationMs,
          }) +
          '\n'
      );
    } else {
      console.log(
        '\n' +
          renderErrorCard({
            routine,
            exitCode,
            repoRoot: targetDir,
            issue: effectiveIssue,
            pr: effectivePR,
            durationMs,
          }) +
          '\n'
      );
    }
  }

  return {
    success: exitCode === 0,
    exitCode,
    output,
    stderr: accumulatedStderr,
    worktreePath,
    branchName,
    issueNumber: routineIssueNumber,
  };
}
