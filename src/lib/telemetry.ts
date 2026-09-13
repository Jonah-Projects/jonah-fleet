import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { GhExecutor, defaultGhExecutor } from './fleet-query.js';

export const GLOBAL_WEEKLY_TOKEN_BUDGET = 8_750_000; // ~8.75M tokens/week (70% ceiling)

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
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const summary = parseLogToTelemetry(content, { repository: repositoryName });
          if (summary) summaries.push(summary);
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

export function renderTelemetryDashboard(
  telemetry: AggregatedTelemetry,
  options: { json?: boolean } = {}
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
    lines.push(
      `   • ${pc.cyan(routineName.padEnd(30))} ` +
        `Runs: ${pc.bold(r.runCount.toString().padStart(2))} | ` +
        `Tokens: ${pc.bold(formatTokens(r.totalTokens).padStart(7))} | ` +
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
