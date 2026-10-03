import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pc from 'picocolors';
import { GhExecutor, defaultGhExecutor } from './fleet-query.js';

const execFileAsync = promisify(execFile);

export const GLOBAL_WEEKLY_TOKEN_BUDGET = 8_750_000; // ~8.75M tokens/week (70% ceiling)
export const GLOBAL_5H_TOKEN_BUDGET = 2_000_000; // ~2.0M tokens rolling 5h window limit

export interface RunUsageMetrics {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

export type QuotaHealthStatus = 'HEALTHY' | 'WARNING' | 'EXCEEDED';

export interface TokenQuotaPercentages {
  pctOf5hLimit: number;
  pctOfWeeklyLimit: number;
  window5hLimit: number;
  weeklyLimit: number;
}

export interface TokenQuotaWindowUsage {
  windowTokens: number;
  windowLimit: number;
  windowPercentage: number;
  windowStatus: QuotaHealthStatus;
  weeklyTokens: number;
  weeklyLimit: number;
  weeklyPercentage: number;
  weeklyStatus: QuotaHealthStatus;
  status: QuotaHealthStatus;
}

export interface PlanQuotaBucket {
  id: string;
  name: string;
  window: '5h' | 'weekly' | string;
  remainingFraction: number;
  remainingPercentage: number;
  resetTime: string;
  description?: string;
}

export interface PlanQuotaGroup {
  name: string; // e.g. "Gemini Models", "Claude and GPT models"
  description?: string;
  buckets: PlanQuotaBucket[];
  weeklyRemainingPct?: number;
  weeklyResetTime?: string;
  window5hRemainingPct?: number;
  window5hResetTime?: string;
}

export interface ActualPlanQuota {
  available: boolean;
  description?: string;
  groups: Record<string, PlanQuotaGroup>;
  geminiWeeklyRemainingPct?: number;
  gemini5hRemainingPct?: number;
  geminiWeeklyResetTime?: string;
  gemini5hResetTime?: string;
  claudeWeeklyRemainingPct?: number;
  claude5hRemainingPct?: number;
  claudeWeeklyResetTime?: string;
  claude5hResetTime?: string;
  fetchedAt: string;
  error?: string;
}

export interface TokenAnomalyReport {
  type:
    | 'context_asymmetry'
    | 'unilateral_rereview_thrash'
    | 'budget_hog'
    | 'multi_routine_cannibalization'
    | 'plan_quota_velocity'
    | 'token_surge'
    | 'iteration_exhaustion';
  severity: 'WARNING' | 'CRITICAL';
  routine?: string;
  message: string;
  remediation: string;
}

/**
 * Formats a styled quota status badge.
 */
export function formatQuotaStatusBadge(status: QuotaHealthStatus | string): string {
  if (status === 'HEALTHY') return pc.green('[HEALTHY]');
  if (status === 'WARNING') return pc.yellow('[WARNING]');
  if (status === 'EXCEEDED') return pc.red('[EXCEEDED]');
  return pc.red(`[${status}]`);
}

/**
 * Formats a token breakdown string across input, output, and thinking tokens.
 */
export function formatTokenBreakdown(
  usage?: RunUsageMetrics,
  style: 'prefix' | 'suffix' = 'prefix'
): string {
  if (!usage) return '';
  const inTok =
    usage.inputTokens !== undefined
      ? style === 'suffix'
        ? `${usage.inputTokens.toLocaleString()} in`
        : `in: ${usage.inputTokens.toLocaleString()}`
      : '';
  const outTok =
    usage.outputTokens !== undefined
      ? style === 'suffix'
        ? `${usage.outputTokens.toLocaleString()} out`
        : `out: ${usage.outputTokens.toLocaleString()}`
      : '';
  const thinkTok =
    usage.thinkingTokens !== undefined
      ? style === 'suffix'
        ? `${usage.thinkingTokens.toLocaleString()} think`
        : `think: ${usage.thinkingTokens.toLocaleString()}`
      : '';

  return [inTok, outTok, thinkTok].filter(Boolean).join(' · ');
}

/**
 * Calculates a run's token consumption as a percentage of the 5h and weekly budget ceilings.
 */
export function calculateTokenQuotaPercentages(
  totalTokens: number,
  options: { window5hLimit?: number; weeklyLimit?: number } = {}
): TokenQuotaPercentages {
  const window5hLimit = options.window5hLimit ?? GLOBAL_5H_TOKEN_BUDGET;
  const weeklyLimit = options.weeklyLimit ?? GLOBAL_WEEKLY_TOKEN_BUDGET;

  const pctOf5hLimit = window5hLimit > 0 ? (totalTokens / window5hLimit) * 100 : 0;
  const pctOfWeeklyLimit = weeklyLimit > 0 ? (totalTokens / weeklyLimit) * 100 : 0;

  return {
    pctOf5hLimit,
    pctOfWeeklyLimit,
    window5hLimit,
    weeklyLimit,
  };
}

/**
 * Aggregates local routine runs from .jonah-fleet/runs/*.json across 5h and 7d rolling windows.
 */
export function getRollingWindowTokenUsage(
  repoRoot: string,
  options: { window5hLimit?: number; weeklyLimit?: number; now?: number } = {}
): TokenQuotaWindowUsage {
  const window5hLimit = options.window5hLimit ?? GLOBAL_5H_TOKEN_BUDGET;
  const weeklyLimit = options.weeklyLimit ?? GLOBAL_WEEKLY_TOKEN_BUDGET;
  const now = options.now ?? Date.now();

  const window5hCutoff = now - 5 * 3600 * 1000;
  const weeklyCutoff = now - 7 * 86400 * 1000;

  let windowTokens = 0;
  let weeklyTokens = 0;

  const runsDir = path.join(repoRoot, '.jonah-fleet', 'runs');
  if (fs.existsSync(runsDir)) {
    try {
      const files = fs.readdirSync(runsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const fullPath = path.join(runsDir, file);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const data = JSON.parse(content);

          let runTime: number | null = null;
          if (data.timestamp) {
            const parsed = new Date(data.timestamp).getTime();
            if (!isNaN(parsed) && parsed > 0) {
              runTime = parsed;
            }
          }
          if (runTime === null) {
            const stat = fs.statSync(fullPath);
            runTime = stat.mtimeMs;
          }

          if (runTime < weeklyCutoff) continue;

          const tokens =
            data.usage?.totalTokens ??
            data.usage?.total_tokens ??
            data.totalTokens ??
            0;

          if (typeof tokens === 'number' && tokens > 0) {
            weeklyTokens += tokens;
            if (runTime >= window5hCutoff) {
              windowTokens += tokens;
            }
          }
        } catch {
          // Ignore malformed files
        }
      }
    } catch {
      // Ignore readdir errors
    }
  }

  const windowPercentage = window5hLimit > 0 ? (windowTokens / window5hLimit) * 100 : 0;
  const weeklyPercentage = weeklyLimit > 0 ? (weeklyTokens / weeklyLimit) * 100 : 0;

  const resolveStatus = (pct: number): QuotaHealthStatus => {
    if (pct > 100) return 'EXCEEDED';
    if (pct >= 70) return 'WARNING';
    return 'HEALTHY';
  };

  const windowStatus = resolveStatus(windowPercentage);
  const weeklyStatus = resolveStatus(weeklyPercentage);

  let status: QuotaHealthStatus = 'HEALTHY';
  if (windowStatus === 'EXCEEDED' || weeklyStatus === 'EXCEEDED') {
    status = 'EXCEEDED';
  } else if (windowStatus === 'WARNING' || weeklyStatus === 'WARNING') {
    status = 'WARNING';
  }

  return {
    windowTokens,
    windowLimit: window5hLimit,
    windowPercentage,
    windowStatus,
    weeklyTokens,
    weeklyLimit,
    weeklyPercentage,
    weeklyStatus,
    status,
  };
}

/**
 * Parses structured JSON or tabular text output from `agy --output-format json --print /quota`.
 */
export function parseAgyQuotaOutput(raw: string): ActualPlanQuota {
  if (!raw || typeof raw !== 'string') {
    return {
      available: false,
      groups: {},
      fetchedAt: new Date().toISOString(),
    };
  }

  // Check for common error or unauthenticated outputs
  if (
    raw.includes('not logged into Antigravity') ||
    raw.includes('error getting token source') ||
    raw.includes('not authenticated')
  ) {
    return {
      available: false,
      groups: {},
      fetchedAt: new Date().toISOString(),
      error: 'Not logged into Antigravity',
    };
  }

  // Attempt JSON parse
  let jsonData: any = null;
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      jsonData = JSON.parse(trimmed);
    }
  } catch {}

  const groups: Record<string, PlanQuotaGroup> = {};
  let description: string | undefined;

  if (jsonData) {
    const commandData = jsonData.command?.data || jsonData.data || jsonData;
    description = commandData.description;
    const rawGroups = commandData.groups || [];

    for (const g of rawGroups) {
      if (!g || !g.name) continue;
      const groupName = g.name;
      const buckets: PlanQuotaBucket[] = [];
      let weeklyRemainingPct: number | undefined;
      let weeklyResetTime: string | undefined;
      let window5hRemainingPct: number | undefined;
      let window5hResetTime: string | undefined;

      for (const b of g.buckets || []) {
        const remainingFraction = typeof b.remaining_fraction === 'number' ? b.remaining_fraction : 0;
        const remainingPercentage = remainingFraction * 100;
        const resetTime = b.reset_time || '';
        const window = b.window || (b.id?.includes('5h') ? '5h' : 'weekly');

        const bucket: PlanQuotaBucket = {
          id: b.id || '',
          name: b.name || '',
          window,
          remainingFraction,
          remainingPercentage,
          resetTime,
          description: b.description,
        };
        buckets.push(bucket);

        if (window === 'weekly' || b.id?.includes('weekly')) {
          weeklyRemainingPct = remainingPercentage;
          weeklyResetTime = resetTime;
        } else if (window === '5h' || b.id?.includes('5h')) {
          window5hRemainingPct = remainingPercentage;
          window5hResetTime = resetTime;
        }
      }

      groups[groupName] = {
        name: groupName,
        description: g.description,
        buckets,
        weeklyRemainingPct,
        weeklyResetTime,
        window5hRemainingPct,
        window5hResetTime,
      };
    }
  } else {
    // Plain text tabular parsing fallback
    const lines = raw.split('\n');
    for (const line of lines) {
      const match =
        line.match(/^\s*([A-Za-z0-9 ]+?)\t+([^\t]+)\t+(\d+)%\t+(.*)$/) ||
        line.match(/^\s*(.+?)\s{2,}(Weekly Limit Remaining|Five Hour Limit Remaining)\s+(\d+)%\s*(.*)$/);
      if (match) {
        const groupName = match[1].trim();
        const bucketName = match[2].trim();
        const pct = parseInt(match[3], 10);
        const resetTime = match[4].trim();

        if (!groups[groupName]) {
          groups[groupName] = {
            name: groupName,
            buckets: [],
          };
        }

        const isWeekly = bucketName.toLowerCase().includes('weekly');
        const window = isWeekly ? 'weekly' : '5h';

        groups[groupName].buckets.push({
          id: isWeekly
            ? `${groupName.toLowerCase().replace(/\s+/g, '-')}-weekly`
            : `${groupName.toLowerCase().replace(/\s+/g, '-')}-5h`,
          name: bucketName,
          window,
          remainingFraction: pct / 100,
          remainingPercentage: pct,
          resetTime,
        });

        if (isWeekly) {
          groups[groupName].weeklyRemainingPct = pct;
          groups[groupName].weeklyResetTime = resetTime;
        } else {
          groups[groupName].window5hRemainingPct = pct;
          groups[groupName].window5hResetTime = resetTime;
        }
      }
    }
  }

  const hasGroups = Object.keys(groups).length > 0;
  if (!hasGroups) {
    return {
      available: false,
      groups: {},
      fetchedAt: new Date().toISOString(),
      error: raw.length > 0 ? (raw.length > 200 ? raw.slice(0, 200) + '...' : raw) : 'No quota information found',
    };
  }

  const geminiGroup = groups['Gemini Models'];
  const claudeGroup = groups['Claude and GPT models'];

  return {
    available: true,
    description,
    groups,
    geminiWeeklyRemainingPct: geminiGroup?.weeklyRemainingPct,
    gemini5hRemainingPct: geminiGroup?.window5hRemainingPct,
    geminiWeeklyResetTime: geminiGroup?.weeklyResetTime,
    gemini5hResetTime: geminiGroup?.window5hResetTime,
    claudeWeeklyRemainingPct: claudeGroup?.weeklyRemainingPct,
    claude5hRemainingPct: claudeGroup?.window5hRemainingPct,
    claudeWeeklyResetTime: claudeGroup?.weeklyResetTime,
    claude5hResetTime: claudeGroup?.window5hResetTime,
    fetchedAt: new Date().toISOString(),
  };
}

function readCachedPlanQuota(cacheFile: string | undefined, cacheTtlMs: number): ActualPlanQuota | null {
  if (!cacheFile || cacheTtlMs <= 0 || !fs.existsSync(cacheFile)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (
      cached &&
      typeof cached.cachedAt === 'number' &&
      Date.now() - cached.cachedAt < cacheTtlMs &&
      cached.quota
    ) {
      return cached.quota;
    }
  } catch {}
  return null;
}

function writeCachedPlanQuota(cacheFile: string | undefined, quota: ActualPlanQuota): void {
  if (!cacheFile || !quota.available) return;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ cachedAt: Date.now(), quota }, null, 2));
  } catch {}
}

/**
 * Synchronously retrieves actual plan quota from disk cache or by invoking `agy --output-format json --print /quota`.
 */
export function getActualPlanQuotaSync(options: {
  repoRoot?: string;
  cacheTtlMs?: number;
  executor?: () => string;
} = {}): ActualPlanQuota {
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const cacheFile = options.repoRoot ? path.join(options.repoRoot, '.jonah-fleet', 'plan-quota-cache.json') : undefined;
  const cached = readCachedPlanQuota(cacheFile, cacheTtlMs);
  if (cached) return cached;

  try {
    let rawOutput: string;
    if (options.executor) {
      rawOutput = options.executor();
    } else if (process.env.VITEST) {
      return {
        available: false,
        groups: {},
        fetchedAt: new Date().toISOString(),
        error: 'Skipped in test environment',
      };
    } else {
      rawOutput = execSync('agy --output-format json --print "/quota"', {
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    }

    const quota = parseAgyQuotaOutput(rawOutput);
    writeCachedPlanQuota(cacheFile, quota);
    return quota;
  } catch (err: any) {
    return {
      available: false,
      groups: {},
      fetchedAt: new Date().toISOString(),
      error: err?.message || String(err),
    };
  }
}

/**
 * Asynchronously retrieves actual plan quota from disk cache or by invoking `agy --output-format json --print /quota`.
 */
export async function fetchActualPlanQuota(options: {
  repoRoot?: string;
  cacheTtlMs?: number;
  executor?: () => Promise<string> | string;
} = {}): Promise<ActualPlanQuota> {
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const cacheFile = options.repoRoot ? path.join(options.repoRoot, '.jonah-fleet', 'plan-quota-cache.json') : undefined;
  const cached = readCachedPlanQuota(cacheFile, cacheTtlMs);
  if (cached) return cached;

  try {
    let rawOutput: string;
    if (options.executor) {
      rawOutput = await options.executor();
    } else if (process.env.VITEST) {
      return {
        available: false,
        groups: {},
        fetchedAt: new Date().toISOString(),
        error: 'Skipped in test environment',
      };
    } else {
      const { stdout } = await execFileAsync('agy', ['--output-format', 'json', '--print', '/quota'], {
        timeout: 10000,
      });
      rawOutput = stdout;
    }

    const quota = parseAgyQuotaOutput(rawOutput);
    writeCachedPlanQuota(cacheFile, quota);
    return quota;
  } catch (err: any) {
    return {
      available: false,
      groups: {},
      fetchedAt: new Date().toISOString(),
      error: err?.message || String(err),
    };
  }
}

/**
 * Formats a clean human-readable summary of plan quota for display.
 */
export function formatPlanQuotaSummary(
  quota: ActualPlanQuota,
  options: { markdown?: boolean } = {}
): string {
  if (!quota || !quota.available) {
    return 'Plan Quota: Unavailable';
  }

  const parts: string[] = [];
  const fmt = (pct: number) =>
    options.markdown ? `\`${pct.toFixed(1)}% remaining\`` : `${pct.toFixed(1)}% remaining`;

  if (quota.gemini5hRemainingPct !== undefined || quota.geminiWeeklyRemainingPct !== undefined) {
    const subParts: string[] = [];
    if (quota.gemini5hRemainingPct !== undefined) {
      subParts.push(`Gemini 5h: ${fmt(quota.gemini5hRemainingPct)}`);
    }
    if (quota.geminiWeeklyRemainingPct !== undefined) {
      const label = quota.gemini5hRemainingPct !== undefined ? 'Weekly' : 'Gemini Weekly';
      subParts.push(`${label}: ${fmt(quota.geminiWeeklyRemainingPct)}`);
    }
    if (subParts.length > 0) {
      parts.push(subParts.join(' · '));
    }
  }

  if (quota.claude5hRemainingPct !== undefined || quota.claudeWeeklyRemainingPct !== undefined) {
    const subParts: string[] = [];
    if (quota.claude5hRemainingPct !== undefined) {
      subParts.push(`Claude/GPT 5h: ${fmt(quota.claude5hRemainingPct)}`);
    }
    if (quota.claudeWeeklyRemainingPct !== undefined) {
      const label = quota.claude5hRemainingPct !== undefined ? 'Weekly' : 'Claude/GPT Weekly';
      subParts.push(`${label}: ${fmt(quota.claudeWeeklyRemainingPct)}`);
    }
    if (subParts.length > 0) {
      parts.push(subParts.join(' · '));
    }
  }

  return parts.join(options.markdown ? '<br>' : '\n');
}

export interface RoutineTelemetrySummary {
  schemaVersion: '1.0.0';
  routine: string;
  timestamp: string;
  repository: string;
  runId?: string;
  runNumber?: number;
  result: 'SUCCESS' | 'FAILURE' | 'BOUNCED_TO_DRAFT' | string;
  errorReason?: string;
  failureCategory?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationSeconds?: number;
  iterationsUsed?: number;
  maxIterations?: number;
  reviewLoops?: number;
  promptSha?: string;
  ambiguityGateTriggered?: boolean;
  questionsAskedCount?: number;
  needsInfoApplied?: boolean;
}

export interface WeeklyBudgetStatus {
  weeklyCeilingTokens: number;
  usedTokens: number;
  remainingTokens: number;
  utilizationPercentage: number;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EXCEEDED';
  dailyBurnRate: number;
  projectedExhaustionDays: number;
}

export interface RoutineMetricBreakdown {
  routine: string;
  runCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  successCount: number;
  failureCount: number;
  bouncedCount: number;
  avgDurationSeconds: number;
  avgIterationsUsed: number;
  ambiguityGatesTriggered: number;
  questionsAskedCount: number;
  needsInfoAppliedCount: number;
}

export interface RepositoryMetricBreakdown {
  repository: string;
  runCount: number;
  totalTokens: number;
  totalEstimatedCost: number;
  successCount: number;
  failureCount: number;
}

export interface AmbiguityMetrics {
  totalAmbiguityGatesTriggered: number;
  totalQuestionsAsked: number;
  needsInfoAppliedCount: number;
  estimatedTokensSaved: number;
}

export interface AggregatedTelemetry {
  timestamp: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  bouncedCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  budget: WeeklyBudgetStatus;
  byRoutine: Record<string, RoutineMetricBreakdown>;
  byRepository: Record<string, RepositoryMetricBreakdown>;
  failureCategories: Record<string, number>;
  ambiguity: AmbiguityMetrics;
  events: RoutineTelemetrySummary[];
}

export function parseLogToTelemetry(
  content: string,
  options: { repository?: string; runId?: string; runNumber?: number } = {}
): RoutineTelemetrySummary | null {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split('\n');
  const metadata: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (!match) continue;

    const key = match[1].trim().toLowerCase();
    const val = match[2].trim().replace(/`/g, '');
    metadata[key] = val;
  }

  if (!metadata['timestamp'] && !metadata['routine']) {
    return null;
  }

  const routine = metadata['routine'] || 'unknown';
  const timestamp = metadata['timestamp'] || new Date().toISOString();
  const result = metadata['result'] || 'UNKNOWN';
  const errorReasonRaw = metadata['error reason'];
  const errorReason = errorReasonRaw && errorReasonRaw.toUpperCase() !== 'N/A' ? errorReasonRaw : undefined;

  let failureCategory = metadata['failure category'];
  if (!failureCategory && result === 'FAILURE' && errorReason) {
    const lower = errorReason.toLowerCase();
    if (lower.includes('token') || lower.includes('ceiling')) {
      failureCategory = 'token_limit';
    } else if (lower.includes('build') || lower.includes('type-check')) {
      failureCategory = 'build_error';
    } else if (lower.includes('infeasible') || lower.includes('blocker')) {
      failureCategory = 'infeasible';
    } else if (lower.includes('conflict')) {
      failureCategory = 'merge_conflict';
    } else if (lower.includes('ambiguous') || lower.includes('needs-info') || lower.includes('clarification') || lower.includes('acceptance criteria')) {
      failureCategory = 'ambiguous_spec';
    }
  }

  const inputTokens = parseInt((metadata['input tokens'] || '0').replace(/[^\d]/g, ''), 10) || 0;
  const outputTokens = parseInt((metadata['output tokens'] || '0').replace(/[^\d]/g, ''), 10) || 0;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = parseFloat((metadata['estimated cost'] || '0').replace(/[^0-9.]/g, '')) || 0;

  let durationSeconds: number | undefined;
  if (metadata['duration']) {
    const durNum = parseInt(metadata['duration'].replace(/[^\d]/g, ''), 10);
    if (!isNaN(durNum)) durationSeconds = durNum;
  }

  let iterationsUsed: number | undefined;
  let maxIterations: number | undefined;
  if (metadata['iterations used']) {
    const iterMatch = metadata['iterations used'].match(/(\d+)\s*\/\s*(\d+)/);
    if (iterMatch) {
      iterationsUsed = parseInt(iterMatch[1], 10);
      maxIterations = parseInt(iterMatch[2], 10);
    } else {
      const singleNum = parseInt(metadata['iterations used'].replace(/[^\d]/g, ''), 10);
      if (!isNaN(singleNum)) iterationsUsed = singleNum;
    }
  }

  const promptSha = metadata['prompt sha'];

  const lowerContent = content.toLowerCase();
  const ambiguityGateTriggered =
    lowerContent.includes('ambiguity & missing acceptance criteria gate') ||
    lowerContent.includes('ambiguity gate') ||
    lowerContent.includes('clarifications needed before implementation') ||
    (lowerContent.includes('needs-info') && (lowerContent.includes('clarification') || lowerContent.includes('questions')));

  const needsInfoApplied = lowerContent.includes('needs-info');

  let questionsAskedCount: number | undefined;
  if (ambiguityGateTriggered) {
    const questionLines = content.split('\n').filter(
      (line) =>
        (line.trim().startsWith('1.') || line.trim().startsWith('2.') || line.trim().startsWith('3.') || line.trim().startsWith('-')) &&
        line.includes('?')
    );
    questionsAskedCount = questionLines.length > 0 ? questionLines.length : 2;
  }

  return {
    schemaVersion: '1.0.0',
    routine,
    timestamp,
    repository: options.repository || 'local',
    runId: options.runId,
    runNumber: options.runNumber,
    result,
    errorReason,
    failureCategory,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
    durationSeconds,
    iterationsUsed,
    maxIterations,
    promptSha,
    ambiguityGateTriggered: ambiguityGateTriggered || undefined,
    questionsAskedCount,
    needsInfoApplied: needsInfoApplied || undefined,
  };
}

export function checkWeeklyBudgetLimit(
  usedTokens: number,
  ceilingTokens: number = GLOBAL_WEEKLY_TOKEN_BUDGET
): WeeklyBudgetStatus {
  const remainingTokens = Math.max(0, ceilingTokens - usedTokens);
  const utilizationPercentage = ceilingTokens > 0 ? (usedTokens / ceilingTokens) * 100 : 0;
  const dailyBurnRate = usedTokens / 7;
  const projectedExhaustionDays = dailyBurnRate > 0 ? remainingTokens / dailyBurnRate : 999;

  let status: WeeklyBudgetStatus['status'] = 'HEALTHY';
  if (usedTokens > ceilingTokens) {
    status = 'EXCEEDED';
  } else if (utilizationPercentage >= 90) {
    status = 'CRITICAL';
  } else if (utilizationPercentage >= 70) {
    status = 'WARNING';
  }

  return {
    weeklyCeilingTokens: ceilingTokens,
    usedTokens,
    remainingTokens,
    utilizationPercentage,
    status,
    dailyBurnRate,
    projectedExhaustionDays,
  };
}

export function aggregateFleetTelemetry(
  summaries: RoutineTelemetrySummary[],
  options: { weeklyTokenBudget?: number } = {}
): AggregatedTelemetry {
  const budgetCeiling = options.weeklyTokenBudget || GLOBAL_WEEKLY_TOKEN_BUDGET;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let successCount = 0;
  let failureCount = 0;
  let bouncedCount = 0;

  const byRoutine: Record<string, RoutineMetricBreakdown> = {};
  const byRepository: Record<string, RepositoryMetricBreakdown> = {};
  const failureCategories: Record<string, number> = {};

  for (const s of summaries) {
    totalInputTokens += s.inputTokens;
    totalOutputTokens += s.outputTokens;
    totalCost += s.estimatedCost;

    if (s.result === 'SUCCESS') successCount++;
    else if (s.result === 'FAILURE') failureCount++;
    else if (s.result === 'BOUNCED_TO_DRAFT') bouncedCount++;

    if (s.failureCategory) {
      failureCategories[s.failureCategory] = (failureCategories[s.failureCategory] || 0) + 1;
    }

    // By Routine
    if (!byRoutine[s.routine]) {
      byRoutine[s.routine] = {
        routine: s.routine,
        runCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalEstimatedCost: 0,
        successCount: 0,
        failureCount: 0,
        bouncedCount: 0,
        avgDurationSeconds: 0,
        avgIterationsUsed: 0,
        ambiguityGatesTriggered: 0,
        questionsAskedCount: 0,
        needsInfoAppliedCount: 0,
      };
    }
    const r = byRoutine[s.routine];
    r.runCount++;
    r.totalInputTokens += s.inputTokens;
    r.totalOutputTokens += s.outputTokens;
    r.totalTokens += s.totalTokens;
    r.totalEstimatedCost += s.estimatedCost;
    if (s.result === 'SUCCESS') r.successCount++;
    else if (s.result === 'FAILURE') r.failureCount++;
    else if (s.result === 'BOUNCED_TO_DRAFT') r.bouncedCount++;
    if (s.durationSeconds) {
      r.avgDurationSeconds = (r.avgDurationSeconds * (r.runCount - 1) + s.durationSeconds) / r.runCount;
    }
    if (s.iterationsUsed) {
      r.avgIterationsUsed = (r.avgIterationsUsed * (r.runCount - 1) + s.iterationsUsed) / r.runCount;
    }
    if (s.ambiguityGateTriggered) r.ambiguityGatesTriggered++;
    if (s.questionsAskedCount) r.questionsAskedCount += s.questionsAskedCount;
    if (s.needsInfoApplied) r.needsInfoAppliedCount++;

    // By Repository
    if (!byRepository[s.repository]) {
      byRepository[s.repository] = {
        repository: s.repository,
        runCount: 0,
        totalTokens: 0,
        totalEstimatedCost: 0,
        successCount: 0,
        failureCount: 0,
      };
    }
    const repoObj = byRepository[s.repository];
    repoObj.runCount++;
    repoObj.totalTokens += s.totalTokens;
    repoObj.totalEstimatedCost += s.estimatedCost;
    if (s.result === 'SUCCESS') repoObj.successCount++;
    else if (s.result === 'FAILURE') repoObj.failureCount++;
  }

  let totalAmbiguityGatesTriggered = 0;
  let totalQuestionsAsked = 0;
  let totalNeedsInfoApplied = 0;

  for (const s of summaries) {
    if (s.ambiguityGateTriggered) totalAmbiguityGatesTriggered++;
    if (s.questionsAskedCount) totalQuestionsAsked += s.questionsAskedCount;
    if (s.needsInfoApplied) totalNeedsInfoApplied++;
  }

  const estimatedTokensSaved = totalAmbiguityGatesTriggered * 50_000;
  const ambiguity: AmbiguityMetrics = {
    totalAmbiguityGatesTriggered,
    totalQuestionsAsked,
    needsInfoAppliedCount: totalNeedsInfoApplied,
    estimatedTokensSaved,
  };

  const totalTokens = totalInputTokens + totalOutputTokens;
  const budget = checkWeeklyBudgetLimit(totalTokens, budgetCeiling);

  return {
    timestamp: new Date().toISOString(),
    totalRuns: summaries.length,
    successCount,
    failureCount,
    bouncedCount,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalEstimatedCost: totalCost,
    budget,
    byRoutine,
    byRepository,
    failureCategories,
    ambiguity,
    events: summaries,
  };
}

export async function emitTelemetry(
  summary: RoutineTelemetrySummary,
  endpoint?: string,
  customFetch: typeof fetch = globalThis.fetch
): Promise<{ success: boolean; error?: string }> {
  if (!endpoint || !endpoint.trim()) {
    return { success: true }; // Opt-in: if endpoint not set, no-op success
  }

  try {
    const res = await customFetch(endpoint.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'jonah-fleet-telemetry/1.0',
      },
      body: JSON.stringify(summary),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown network error' };
  }
}

export function collectLocalTelemetryLogs(dir: string, repositoryName: string = 'local'): RoutineTelemetrySummary[] {
  const summaries: RoutineTelemetrySummary[] = [];
  const runsDir = path.join(dir, '.jonah-fleet/runs');
  const legacyLogsDir = path.join(dir, '.github/prompts/logs');

  const traverse = (currentDir: string) => {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    // Collect base names to avoid duplicates when both .md and .json exist
    const filesByBase = new Map<string, { json?: string; md?: string }>();
    for (const entry of entries) {
      if (entry.isDirectory()) {
        traverse(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.md')) {
          const base = entry.name.slice(0, -3);
          const current = filesByBase.get(base) || {};
          current.md = path.join(currentDir, entry.name);
          filesByBase.set(base, current);
        } else if (entry.name.endsWith('.json')) {
          const base = entry.name.slice(0, -5);
          const current = filesByBase.get(base) || {};
          current.json = path.join(currentDir, entry.name);
          filesByBase.set(base, current);
        }
      }
    }

    for (const [, paths] of filesByBase) {
      let parsed = false;
      if (paths.md) {
        try {
          const content = fs.readFileSync(paths.md, 'utf8');
          const summary = parseLogToTelemetry(content, { repository: repositoryName });
          if (summary) {
            summaries.push(summary);
            parsed = true;
          }
        } catch {}
      }
      if (!parsed && paths.json) {
        try {
          const content = fs.readFileSync(paths.json, 'utf8');
          const data = JSON.parse(content);
          if (data.routine && data.timestamp) {
            const inTokens = data.usage?.inputTokens ?? data.usage?.input_tokens ?? data.inputTokens ?? 0;
            const outTokens = data.usage?.outputTokens ?? data.usage?.output_tokens ?? data.outputTokens ?? 0;
            const totTokens = data.usage?.totalTokens ?? data.usage?.total_tokens ?? data.totalTokens ?? (inTokens + outTokens);
            const durationSec = data.durationMs ? Math.round(data.durationMs / 1000) : (data.durationSeconds ?? undefined);
            const result = data.result ?? (data.success === true ? 'SUCCESS' : data.success === false ? 'FAILURE' : 'UNKNOWN');

            summaries.push({
              schemaVersion: '1.0.0',
              routine: data.routine,
              repository: repositoryName,
              timestamp: data.timestamp,
              result,
              errorReason: data.errorReason || data.error,
              failureCategory: data.failureCategory,
              inputTokens: inTokens,
              outputTokens: outTokens,
              totalTokens: totTokens,
              estimatedCost: data.estimatedCost ?? (totTokens / 1_000_000) * 0.35,
              durationSeconds: durationSec,
              iterationsUsed: data.iterationsUsed,
              maxIterations: data.maxIterations,
              ambiguityGateTriggered: Boolean(data.ambiguityGateTriggered),
              questionsAskedCount: data.questionsAskedCount || 0,
              needsInfoApplied: Boolean(data.needsInfoApplied),
            });
          }
        } catch {}
      }
    }
  };

  if (fs.existsSync(runsDir)) {
    traverse(runsDir);
  }
  if (fs.existsSync(legacyLogsDir)) {
    traverse(legacyLogsDir);
  }
  return summaries;
}

export async function collectRepoTelemetry(
  repoIdentifier: string,
  executor: GhExecutor = defaultGhExecutor,
  options: { maxLogs?: number; now?: number } = {}
): Promise<RoutineTelemetrySummary[]> {
  const summaries: RoutineTelemetrySummary[] = [];

  if (fs.existsSync(repoIdentifier) && fs.statSync(repoIdentifier).isDirectory()) {
    return collectLocalTelemetryLogs(repoIdentifier, repoIdentifier);
  }

  // 1. Primary: query GitHub Issues labeled routine-log
  try {
    const issuesRaw = await executor([
      'issue',
      'list',
      '--repo',
      repoIdentifier,
      '--label',
      'routine-log',
      '--state',
      'all',
      '--limit',
      String(options.maxLogs || 25),
      '--json',
      'body,number,title,createdAt',
    ]);
    const issues = JSON.parse(issuesRaw);
    if (Array.isArray(issues) && issues.length > 0) {
      for (const issue of issues) {
        if (issue.body) {
          const summary = parseLogToTelemetry(issue.body, { repository: repoIdentifier });
          if (summary) summaries.push(summary);
        }
      }
      if (summaries.length > 0) {
        return summaries;
      }
    }
  } catch {}

  // 2. Fallback: query legacy git trees for .github/prompts/logs/
  try {
    const treeRaw = await executor([
      'api',
      `repos/${repoIdentifier}/git/trees/HEAD?recursive=1`,
    ]);
    const tree = JSON.parse(treeRaw);
    if (Array.isArray(tree.tree)) {
      const logFiles = tree.tree
        .filter((node: any) => node.path && node.path.startsWith('.github/prompts/logs/') && node.path.endsWith('.md'))
        .slice(-(options.maxLogs || 25));

      for (const file of logFiles) {
        try {
          const fileRaw = await executor(['api', `repos/${repoIdentifier}/contents/${file.path}`]);
          const parsed = JSON.parse(fileRaw);
          if (parsed.content) {
            const content = Buffer.from(parsed.content, 'base64').toString('utf8');
            const summary = parseLogToTelemetry(content, { repository: repoIdentifier });
            if (summary) summaries.push(summary);
          }
        } catch {}
      }
    }
  } catch {}

  return summaries;
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}k`;
  }
  return num.toString();
}

function renderProgressBar(percentage: number, width: number = 25): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filledCount = Math.round((clamped / 100) * width);
  const emptyCount = width - filledCount;

  const filledBar = '█'.repeat(filledCount);
  const emptyBar = '░'.repeat(emptyCount);

  if (clamped >= 90) return pc.red(filledBar) + pc.gray(emptyBar);
  if (clamped >= 70) return pc.yellow(filledBar) + pc.gray(emptyBar);
  return pc.green(filledBar) + pc.gray(emptyBar);
}

export function detectTokenAnomalies(
  telemetry: AggregatedTelemetry,
  options: { actualQuota?: ActualPlanQuota } = {}
): TokenAnomalyReport[] {
  const anomalies: TokenAnomalyReport[] = [];

  // 1. Context Asymmetry & Prompt Bloat
  // Routine inputTokens / outputTokens > 35:1 with significant input volume (>50k)
  for (const [routineName, r] of Object.entries(telemetry.byRoutine)) {
    const ratio = r.totalInputTokens / Math.max(1, r.totalOutputTokens);
    if (ratio > 35 && r.totalInputTokens > 50_000) {
      anomalies.push({
        type: 'context_asymmetry',
        severity: 'WARNING',
        routine: routineName,
        message: `Context Asymmetry on '${routineName}': Input/Output ratio is ${ratio.toFixed(1)}:1 (${r.totalInputTokens.toLocaleString()} input vs ${r.totalOutputTokens.toLocaleString()} output tokens).`,
        remediation: `Apply progressive disclosure and skill pruning. Scope skills strictly per routine rather than injecting all skills globally.`,
      });
    }
  }

  // 2. Budget Hog (Single routine consumes > 75% of fleet tokens)
  if (telemetry.totalTokens > 0) {
    for (const [routineName, r] of Object.entries(telemetry.byRoutine)) {
      const share = (r.totalTokens / telemetry.totalTokens) * 100;
      if (share > 75 && Object.keys(telemetry.byRoutine).length > 1) {
        anomalies.push({
          type: 'budget_hog',
          severity: 'CRITICAL',
          routine: routineName,
          message: `Budget Hog on '${routineName}': Consumes ${share.toFixed(1)}% of total fleet token allowance.`,
          remediation: `Throttle dispatch cadence, introduce stricter pre-qualification filters, or add early exit guards.`,
        });
      }
    }
  }

  // 3. Multi-Routine Budget Cannibalization (Top 2 routines consume > 80% of fleet tokens)
  if (telemetry.totalTokens > 0 && Object.keys(telemetry.byRoutine).length >= 2) {
    const sortedRoutines = Object.values(telemetry.byRoutine).sort(
      (a, b) => b.totalTokens - a.totalTokens
    );
    const top2Spend = (sortedRoutines[0]?.totalTokens || 0) + (sortedRoutines[1]?.totalTokens || 0);
    const top2Share = (top2Spend / telemetry.totalTokens) * 100;
    if (top2Share > 80) {
      anomalies.push({
        type: 'multi_routine_cannibalization',
        severity: 'WARNING',
        message: `Multi-Routine Budget Cannibalization: Top 2 routines ('${sortedRoutines[0]?.routine}' and '${sortedRoutines[1]?.routine}') consume ${top2Share.toFixed(1)}% of fleet tokens.`,
        remediation: `Rebalance dispatch pacing and coordinate candidate skips across authoring and review routines.`,
      });
    }
  }

  // 4. Iteration Ceiling Exhaustion (>20% runs terminate at token_limit)
  for (const [routineName, r] of Object.entries(telemetry.byRoutine)) {
    if (r.runCount >= 3) {
      const tokenLimitFailures = (telemetry.events || []).filter(
        (e) => e.routine === routineName && e.failureCategory === 'token_limit'
      ).length;
      const failPct = (tokenLimitFailures / r.runCount) * 100;
      if (failPct > 20) {
        anomalies.push({
          type: 'iteration_exhaustion',
          severity: 'WARNING',
          routine: routineName,
          message: `Iteration Ceiling Exhaustion on '${routineName}': ${failPct.toFixed(1)}% of runs terminate at max iteration/token limit.`,
          remediation: `Decompose tasks vertically into smaller slices and tighten pre-ready self-audits.`,
        });
      }
    }
  }

  // 5. Plan Quota Burn Velocity (Actual provider quota remaining is <30% weekly or <20% in 5h window)
  if (options.actualQuota?.available) {
    const geminiWeekly = options.actualQuota.geminiWeeklyRemainingPct;
    const gemini5h = options.actualQuota.gemini5hRemainingPct;
    if (geminiWeekly !== undefined && geminiWeekly < 30) {
      anomalies.push({
        type: 'plan_quota_velocity',
        severity: geminiWeekly < 20 ? 'CRITICAL' : 'WARNING',
        message: `Plan Quota Burn Velocity: Gemini weekly plan quota is at ${geminiWeekly.toFixed(1)}% remaining (<30% threshold).`,
        remediation: `Downgrade auxiliary routines ('peer-review', 'optimizer') to medium reasoning effort and standard Flash models (gemini-3.8-flash-medium).`,
      });
    } else if (gemini5h !== undefined && gemini5h < 20) {
      anomalies.push({
        type: 'plan_quota_velocity',
        severity: 'CRITICAL',
        message: `Plan Quota Burn Velocity: Gemini 5h rolling plan quota is at ${gemini5h.toFixed(1)}% remaining (<20% threshold).`,
        remediation: `Throttle active agent execution to prevent rate limit lockout during the current 5-hour window.`,
      });
    }
  }

  return anomalies;
}

export function renderTelemetryDashboard(
  telemetry: AggregatedTelemetry,
  options: { json?: boolean; actualQuota?: ActualPlanQuota } = {}
): string {
  if (options.json) {
    return JSON.stringify(telemetry, null, 2);
  }

  const lines: string[] = [];
  lines.push(pc.bold(pc.cyan('\n🛰️  Jonah Fleet Telemetry Hub & Token Economics\n')));

  // Budget Box
  const b = telemetry.budget;
  let statusBadge = pc.green('[HEALTHY]');
  if (b.status === 'WARNING') statusBadge = pc.yellow('[WARNING]');
  else if (b.status === 'CRITICAL') statusBadge = pc.red(pc.bold('[CRITICAL]'));
  else if (b.status === 'EXCEEDED') statusBadge = pc.red(pc.bold('[BUDGET EXCEEDED]'));

  lines.push(pc.bold('📈 Global Weekly Token Budget Ceiling (~70% Fleet Limit):'));
  lines.push(
    `   ${renderProgressBar(b.utilizationPercentage, 30)} ${pc.bold(`${b.utilizationPercentage.toFixed(1)}%`)} ${statusBadge}`
  );
  lines.push(
    `   Used: ${pc.bold(formatTokens(b.usedTokens))} / ${formatTokens(b.weeklyCeilingTokens)} tokens ` +
      `| Remaining: ${pc.green(formatTokens(b.remainingTokens))} ` +
      `| Daily Burn: ${formatTokens(b.dailyBurnRate)}/day`
  );

  lines.push('\n' + pc.bold('🌐 Fleet Aggregate Spend:'));
  lines.push(
    `   Total Runs: ${pc.bold(telemetry.totalRuns.toString())} ` +
      `(${pc.green(telemetry.successCount + ' success')}, ${pc.red(telemetry.failureCount + ' failed')}, ${pc.yellow(telemetry.bouncedCount + ' bounced')})`
  );
  lines.push(
    `   Total Tokens: ${pc.bold(formatTokens(telemetry.totalTokens))} ` +
      pc.gray(`(in: ${formatTokens(telemetry.totalInputTokens)}, out: ${formatTokens(telemetry.totalOutputTokens)})`) +
      ` | Est. Cost: ${pc.bold(pc.green(`$${telemetry.totalEstimatedCost.toFixed(2)}`))}`
  );

  // By Routine
  lines.push('\n' + pc.bold('🤖 Spend by Agent Routine:'));
  for (const [routineName, r] of Object.entries(telemetry.byRoutine)) {
    const costStr = pc.green(`$${r.totalEstimatedCost.toFixed(2)}`);
    const ratio = (r.totalInputTokens / Math.max(1, r.totalOutputTokens)).toFixed(0);
    lines.push(
      `   • ${pc.cyan(routineName.padEnd(30))} ` +
        `Runs: ${pc.bold(r.runCount.toString().padStart(2))} | ` +
        `Tokens: ${pc.bold(formatTokens(r.totalTokens).padStart(7))} | ` +
        `I/O: ${ratio.padStart(2)}:1 | ` +
        `Cost: ${costStr.padStart(6)} | ` +
        `Avg Iter: ${r.avgIterationsUsed.toFixed(1)}`
    );
  }

  // By Repository
  if (Object.keys(telemetry.byRepository).length > 0) {
    lines.push('\n' + pc.bold('📦 Spend by Repository:'));
    for (const [repoName, repoObj] of Object.entries(telemetry.byRepository)) {
      lines.push(
        `   • ${pc.bold(repoName)}: ${formatTokens(repoObj.totalTokens)} tokens across ${repoObj.runCount} runs ($${repoObj.totalEstimatedCost.toFixed(2)})`
      );
    }
  }

  // Inquisitive Stance & Ambiguity Signals
  const amb = telemetry.ambiguity;
  lines.push('\n' + pc.bold('❓ Inquisitive Stance & Ambiguity Gate Signals:'));
  lines.push(
    `   • Ambiguity Gate Triggers:    ${pc.bold(amb.totalAmbiguityGatesTriggered.toString())} runs stopped to request clarification`
  );
  lines.push(
    `   • Clarifying Questions Posed: ${pc.bold(amb.totalQuestionsAsked.toString())} targeted questions`
  );
  lines.push(
    `   • Needs-Info Labels Applied:  ${pc.bold(amb.needsInfoAppliedCount.toString())}`
  );
  lines.push(
    `   • Est. Wasted Tokens Averted: ~${pc.bold(pc.green(formatTokens(amb.estimatedTokensSaved)))} tokens (avoided speculative builds)`
  );

  // Detected Anomalies
  const anomalies = detectTokenAnomalies(telemetry, { actualQuota: options.actualQuota });
  if (anomalies.length > 0) {
    lines.push('\n' + pc.bold(pc.yellow('🚨 Detected Token & Pacing Anomalies:')));
    for (const anom of anomalies) {
      const badge = anom.severity === 'CRITICAL' ? pc.red('[CRITICAL]') : pc.yellow('[WARNING]');
      lines.push(`   ${badge} ${anom.message}`);
      lines.push(pc.gray(`     ↳ Remediation: ${anom.remediation}`));
    }
  }

  // Failure breakdown
  const failKeys = Object.keys(telemetry.failureCategories);
  if (failKeys.length > 0) {
    lines.push('\n' + pc.bold(pc.red('⚠️  Failure Categories Breakdown:')));
    for (const cat of failKeys) {
      lines.push(`   - ${cat}: ${telemetry.failureCategories[cat]} occurrences`);
    }
  }

  lines.push('\n' + pc.gray('─'.repeat(65)) + '\n');
  return lines.join('\n');
}
