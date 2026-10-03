import { describe, it, expect, vi } from 'vitest';
import {
  parseLogToTelemetry,
  aggregateFleetTelemetry,
  checkWeeklyBudgetLimit,
  emitTelemetry,
  renderTelemetryDashboard,
  collectLocalTelemetryLogs,
  collectRepoTelemetry,
  RoutineTelemetrySummary,
  GLOBAL_WEEKLY_TOKEN_BUDGET,
  GLOBAL_5H_TOKEN_BUDGET,
  calculateTokenQuotaPercentages,
  getRollingWindowTokenUsage,
  formatQuotaStatusBadge,
  formatTokenBreakdown,
  parseAgyQuotaOutput,
  fetchActualPlanQuota,
  getActualPlanQuotaSync,
  formatPlanQuotaSummary,
  detectTokenAnomalies,
  formatIoRatio,
  TOKEN_ANOMALY_THRESHOLDS,
} from '../src/lib/telemetry.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+m/g, '');
}

describe('Fleet Telemetry Hub', () => {
  const sampleSuccessLog = `
# Run Log
## Metadata
| Field | Value |
|-------|-------|
| Routine | \`autowork\` |
| Timestamp | \`2026-08-25T14:30:00Z\` |
| Prompt file | \`.github/prompts/autowork.md\` |
| Prompt SHA | \`a1b2c3d\` |
| Result | \`SUCCESS\` |
| Error reason | N/A |
| Input tokens | 85000 |
| Output tokens | 6500 |
| Estimated cost | $0.26 |
| Duration | 210s |
| Iterations used | 18 / 65 |
`;

  const sampleFailureLog = `
# Run Log
## Metadata
| Field | Value |
|-------|-------|
| Routine | \`autowork\` |
| Timestamp | \`2026-08-25T18:00:00Z\` |
| Prompt file | \`.github/prompts/autowork.md\` |
| Prompt SHA | \`a1b2c3d\` |
| Result | \`FAILURE\` |
| Error reason | Token limit exceeded during code generation |
| Failure category | \`token_limit\` |
| Input tokens | 250000 |
| Output tokens | 15000 |
| Estimated cost | $0.78 |
| Duration | 600s |
| Iterations used | 65 / 65 |
`;

  const samplePeerReviewLog = `
# Run Log
## Metadata
| Field | Value |
|-------|-------|
| Routine | \`peer-review\` |
| Timestamp | \`2026-08-26T01:00:00Z\` |
| Prompt file | \`.github/prompts/peer-review.md\` |
| Result | \`BOUNCED_TO_DRAFT\` |
| Error reason | Missing tests for edge case |
| Input tokens | 40000 |
| Output tokens | 3000 |
| Estimated cost | $0.12 |
| Duration | 95s |
| Iterations used | 8 / 30 |
`;

  describe('parseLogToTelemetry', () => {
    it('correctly parses a successful autowork run log into a telemetry summary', () => {
      const summary = parseLogToTelemetry(sampleSuccessLog, {
        repository: 'owner/repo-a',
        runId: '12345678',
        runNumber: 42,
      });

      expect(summary).not.toBeNull();
      expect(summary?.schemaVersion).toBe('1.0.0');
      expect(summary?.routine).toBe('autowork');
      expect(summary?.repository).toBe('owner/repo-a');
      expect(summary?.runId).toBe('12345678');
      expect(summary?.runNumber).toBe(42);
      expect(summary?.result).toBe('SUCCESS');
      expect(summary?.inputTokens).toBe(85000);
      expect(summary?.outputTokens).toBe(6500);
      expect(summary?.totalTokens).toBe(91500);
      expect(summary?.estimatedCost).toBe(0.26);
      expect(summary?.durationSeconds).toBe(210);
      expect(summary?.iterationsUsed).toBe(18);
      expect(summary?.maxIterations).toBe(65);
      expect(summary?.promptSha).toBe('a1b2c3d');
      expect(summary?.failureCategory).toBeUndefined();
    });

    it('correctly extracts failure details and category from a failure log', () => {
      const summary = parseLogToTelemetry(sampleFailureLog, {
        repository: 'owner/repo-b',
      });

      expect(summary).not.toBeNull();
      expect(summary?.result).toBe('FAILURE');
      expect(summary?.errorReason).toBe('Token limit exceeded during code generation');
      expect(summary?.failureCategory).toBe('token_limit');
      expect(summary?.iterationsUsed).toBe(65);
      expect(summary?.maxIterations).toBe(65);
      expect(summary?.totalTokens).toBe(265000);
    });

    it('handles review routine bounce results', () => {
      const summary = parseLogToTelemetry(samplePeerReviewLog, {
        repository: 'owner/repo-a',
      });

      expect(summary).not.toBeNull();
      expect(summary?.routine).toBe('peer-review');
      expect(summary?.result).toBe('BOUNCED_TO_DRAFT');
      expect(summary?.totalTokens).toBe(43000);
    });

    it('returns null for empty or invalid markdown log content', () => {
      expect(parseLogToTelemetry('')).toBeNull();
      expect(parseLogToTelemetry('Just a random text file with no table')).toBeNull();
    });
  });

  describe('checkWeeklyBudgetLimit', () => {
    it('evaluates budget health when well within the 70% budget ceiling', () => {
      const budget = checkWeeklyBudgetLimit(2_000_000, GLOBAL_WEEKLY_TOKEN_BUDGET);
      expect(budget.weeklyCeilingTokens).toBe(8_750_000);
      expect(budget.usedTokens).toBe(2_000_000);
      expect(budget.remainingTokens).toBe(6_750_000);
      expect(budget.utilizationPercentage).toBeCloseTo(22.86, 1);
      expect(budget.status).toBe('HEALTHY');
      expect(budget.dailyBurnRate).toBeCloseTo(285714.28, 0);
    });

    it('warns when token spend enters 70% - 90% threshold', () => {
      const budget = checkWeeklyBudgetLimit(7_000_000, GLOBAL_WEEKLY_TOKEN_BUDGET);
      expect(budget.utilizationPercentage).toBe(80);
      expect(budget.status).toBe('WARNING');
    });

    it('flags CRITICAL when spend reaches 90% - 100% threshold', () => {
      const budget = checkWeeklyBudgetLimit(8_000_000, GLOBAL_WEEKLY_TOKEN_BUDGET);
      expect(budget.utilizationPercentage).toBeCloseTo(91.43, 1);
      expect(budget.status).toBe('CRITICAL');
    });

    it('flags EXCEEDED when spend surpasses the weekly ceiling', () => {
      const budget = checkWeeklyBudgetLimit(9_500_000, GLOBAL_WEEKLY_TOKEN_BUDGET);
      expect(budget.remainingTokens).toBe(0);
      expect(budget.utilizationPercentage).toBeCloseTo(108.57, 1);
      expect(budget.status).toBe('EXCEEDED');
    });
  });

  describe('calculateTokenQuotaPercentages', () => {
    it('calculates percentages of 5h limit and weekly limit accurately', () => {
      const result = calculateTokenQuotaPercentages(20_000);
      expect(result.window5hLimit).toBe(2_000_000);
      expect(result.weeklyLimit).toBe(8_750_000);
      // 20,000 / 2,000,000 = 1.0%
      expect(result.pctOf5hLimit).toBe(1.0);
      // 20,000 / 8,750,000 = ~0.2285%
      expect(result.pctOfWeeklyLimit).toBeCloseTo(0.23, 2);
    });

    it('respects custom 5h and weekly limits if supplied', () => {
      const result = calculateTokenQuotaPercentages(50_000, {
        window5hLimit: 1_000_000,
        weeklyLimit: 5_000_000,
      });
      expect(result.window5hLimit).toBe(1_000_000);
      expect(result.weeklyLimit).toBe(5_000_000);
      expect(result.pctOf5hLimit).toBe(5.0);
      expect(result.pctOfWeeklyLimit).toBe(1.0);
    });
  });

  describe('getRollingWindowTokenUsage', () => {
    it('aggregates runs within 5h and 7d windows from .jonah-fleet/runs/*.json', () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-rolling-test-'));
      try {
        const runsDir = path.join(tmpRepo, '.jonah-fleet', 'runs');
        fs.mkdirSync(runsDir, { recursive: true });

        const now = Date.now();
        // 1. Run 1 hour ago: 25k tokens
        fs.writeFileSync(
          path.join(runsDir, 'peer-review-1h.json'),
          JSON.stringify({
            routine: 'peer-review',
            timestamp: new Date(now - 1 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 25_000 },
          })
        );
        // Set file mtime to 1 hour ago
        fs.utimesSync(path.join(runsDir, 'peer-review-1h.json'), (now - 1 * 3600 * 1000) / 1000, (now - 1 * 3600 * 1000) / 1000);

        // 2. Run 3 hours ago: 35k tokens
        fs.writeFileSync(
          path.join(runsDir, 'autowork-3h.json'),
          JSON.stringify({
            routine: 'autowork',
            timestamp: new Date(now - 3 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 35_000 },
          })
        );
        fs.utimesSync(path.join(runsDir, 'autowork-3h.json'), (now - 3 * 3600 * 1000) / 1000, (now - 3 * 3600 * 1000) / 1000);

        // 3. Run 24 hours ago: 40k tokens (within 7d, outside 5h)
        fs.writeFileSync(
          path.join(runsDir, 'peer-review-24h.json'),
          JSON.stringify({
            routine: 'peer-review',
            timestamp: new Date(now - 24 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 40_000 },
          })
        );
        fs.utimesSync(path.join(runsDir, 'peer-review-24h.json'), (now - 24 * 3600 * 1000) / 1000, (now - 24 * 3600 * 1000) / 1000);

        // 4. Run 10 days ago: 100k tokens (outside 7d, should be ignored)
        fs.writeFileSync(
          path.join(runsDir, 'autowork-10d.json'),
          JSON.stringify({
            routine: 'autowork',
            timestamp: new Date(now - 10 * 86400 * 1000).toISOString(),
            usage: { totalTokens: 100_000 },
          })
        );
        fs.utimesSync(path.join(runsDir, 'autowork-10d.json'), (now - 10 * 86400 * 1000) / 1000, (now - 10 * 86400 * 1000) / 1000);

        const rolling = getRollingWindowTokenUsage(tmpRepo, { now });
        // 5h window: 25k + 35k = 60k
        expect(rolling.windowTokens).toBe(60_000);
        expect(rolling.windowPercentage).toBeCloseTo(3.0, 1);

        // 7d weekly window: 25k + 35k + 40k = 100k (excludes 10d run)
        expect(rolling.weeklyTokens).toBe(100_000);
        expect(rolling.weeklyPercentage).toBeCloseTo(1.14, 2);
        expect(rolling.status).toBe('HEALTHY');
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it('prefers JSON data.timestamp over file mtimeMs (preventing checkout/clone mtime reset false positives)', () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-mtime-test-'));
      try {
        const runsDir = path.join(tmpRepo, '.jonah-fleet', 'runs');
        fs.mkdirSync(runsDir, { recursive: true });

        const now = Date.now();
        // File is freshly written (mtime is now), but data.timestamp is 24 hours ago
        fs.writeFileSync(
          path.join(runsDir, 'autowork-historical.json'),
          JSON.stringify({
            routine: 'autowork',
            timestamp: new Date(now - 24 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 50_000 },
          })
        );

        const rolling = getRollingWindowTokenUsage(tmpRepo, { now });
        // Since timestamp is 24h ago, 5h window must be 0, even though file mtime is fresh
        expect(rolling.windowTokens).toBe(0);
        expect(rolling.weeklyTokens).toBe(50_000);
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it('calculates independent window and weekly statuses without cross-contamination', () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-pacing-test-'));
      try {
        const runsDir = path.join(tmpRepo, '.jonah-fleet', 'runs');
        fs.mkdirSync(runsDir, { recursive: true });

        const now = Date.now();
        // 5h window: 100,000 tokens (5% of 2.0M -> HEALTHY)
        fs.writeFileSync(
          path.join(runsDir, 'run-recent.json'),
          JSON.stringify({
            routine: 'peer-review',
            timestamp: new Date(now - 1 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 100_000 },
          })
        );

        // Outside 5h, within 7d: 9,000,000 tokens (total weekly = 9.1M > 8.75M limit -> EXCEEDED)
        fs.writeFileSync(
          path.join(runsDir, 'run-older.json'),
          JSON.stringify({
            routine: 'autowork',
            timestamp: new Date(now - 24 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 9_000_000 },
          })
        );

        const rolling = getRollingWindowTokenUsage(tmpRepo, { now });
        expect(rolling.windowTokens).toBe(100_000);
        expect(rolling.windowStatus).toBe('HEALTHY');
        expect(rolling.weeklyTokens).toBe(9_100_000);
        expect(rolling.weeklyStatus).toBe('EXCEEDED');
        expect(rolling.status).toBe('EXCEEDED');
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it('evaluates WARNING pacing status at >=70% and <=100% threshold', () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-warning-test-'));
      try {
        const runsDir = path.join(tmpRepo, '.jonah-fleet', 'runs');
        fs.mkdirSync(runsDir, { recursive: true });

        const now = Date.now();
        // 5h window: 1.5M tokens (75% of 2.0M -> WARNING)
        fs.writeFileSync(
          path.join(runsDir, 'run-warning.json'),
          JSON.stringify({
            routine: 'autowork',
            timestamp: new Date(now - 1 * 3600 * 1000).toISOString(),
            usage: { totalTokens: 1_500_000 },
          })
        );

        const rolling = getRollingWindowTokenUsage(tmpRepo, { now });
        expect(rolling.windowStatus).toBe('WARNING');
        expect(rolling.weeklyStatus).toBe('HEALTHY');
        expect(rolling.status).toBe('WARNING');
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });
  });

  describe('formatQuotaStatusBadge', () => {
    it('formats badges with correct colors and brackets', () => {
      expect(stripAnsi(formatQuotaStatusBadge('HEALTHY'))).toBe('[HEALTHY]');
      expect(stripAnsi(formatQuotaStatusBadge('WARNING'))).toBe('[WARNING]');
      expect(stripAnsi(formatQuotaStatusBadge('EXCEEDED'))).toBe('[EXCEEDED]');
      expect(stripAnsi(formatQuotaStatusBadge('UNKNOWN'))).toBe('[UNKNOWN]');
    });
  });

  describe('formatTokenBreakdown', () => {
    it('formats token breakdown with prefix style', () => {
      const breakdown = formatTokenBreakdown(
        {
          inputTokens: 12500,
          outputTokens: 850,
          thinkingTokens: 1200,
        },
        'prefix'
      );
      expect(breakdown).toBe('in: 12,500 · out: 850 · think: 1,200');
    });

    it('formats token breakdown with suffix style', () => {
      const breakdown = formatTokenBreakdown(
        {
          inputTokens: 12500,
          outputTokens: 850,
          thinkingTokens: 1200,
        },
        'suffix'
      );
      expect(breakdown).toBe('12,500 in · 850 out · 1,200 think');
    });

    it('handles partial usage metrics and undefined usage cleanly', () => {
      expect(formatTokenBreakdown(undefined)).toBe('');
      expect(formatTokenBreakdown({})).toBe('');
      expect(formatTokenBreakdown({ inputTokens: 500 }, 'prefix')).toBe('in: 500');
      expect(formatTokenBreakdown({ outputTokens: 200 }, 'suffix')).toBe('200 out');
    });
  });

  describe('aggregateFleetTelemetry', () => {
    const events: RoutineTelemetrySummary[] = [
      {
        schemaVersion: '1.0.0',
        routine: 'autowork',
        timestamp: '2026-08-25T10:00:00Z',
        repository: 'owner/repo-1',
        result: 'SUCCESS',
        inputTokens: 100_000,
        outputTokens: 5_000,
        totalTokens: 105_000,
        estimatedCost: 0.32,
        durationSeconds: 200,
        iterationsUsed: 15,
        maxIterations: 65,
      },
      {
        schemaVersion: '1.0.0',
        routine: 'autowork',
        timestamp: '2026-08-25T16:00:00Z',
        repository: 'owner/repo-1',
        result: 'FAILURE',
        errorReason: 'Out of memory',
        failureCategory: 'token_limit',
        inputTokens: 200_000,
        outputTokens: 10_000,
        totalTokens: 210_000,
        estimatedCost: 0.65,
        durationSeconds: 450,
        iterationsUsed: 40,
        maxIterations: 65,
      },
      {
        schemaVersion: '1.0.0',
        routine: 'peer-review',
        timestamp: '2026-08-26T08:00:00Z',
        repository: 'owner/repo-2',
        result: 'BOUNCED_TO_DRAFT',
        inputTokens: 50_000,
        outputTokens: 2_000,
        totalTokens: 52_000,
        estimatedCost: 0.15,
        durationSeconds: 90,
        iterationsUsed: 10,
        maxIterations: 30,
      },
      {
        schemaVersion: '1.0.0',
        routine: 'optimizer',
        timestamp: '2026-08-26T10:00:00Z',
        repository: 'owner/repo-2',
        result: 'SUCCESS',
        inputTokens: 30_000,
        outputTokens: 3_000,
        totalTokens: 33_000,
        estimatedCost: 0.10,
        durationSeconds: 120,
        iterationsUsed: 12,
        maxIterations: 35,
      },
    ];

    it('aggregates fleet-wide metrics, routines, repositories, and failure categories', () => {
      const agg = aggregateFleetTelemetry(events);

      expect(agg.totalRuns).toBe(4);
      expect(agg.totalInputTokens).toBe(380_000);
      expect(agg.totalOutputTokens).toBe(20_000);
      expect(agg.totalTokens).toBe(400_000);
      expect(agg.totalEstimatedCost).toBeCloseTo(1.22, 2);
      expect(agg.successCount).toBe(2);
      expect(agg.failureCount).toBe(1);
      expect(agg.bouncedCount).toBe(1);

      // By routine
      expect(agg.byRoutine.autowork.runCount).toBe(2);
      expect(agg.byRoutine.autowork.totalTokens).toBe(315_000);
      expect(agg.byRoutine['peer-review'].runCount).toBe(1);
      expect(agg.byRoutine.optimizer.runCount).toBe(1);

      // By repo
      expect(agg.byRepository['owner/repo-1'].totalTokens).toBe(315_000);
      expect(agg.byRepository['owner/repo-2'].totalTokens).toBe(85_000);

      // Failure breakdown
      expect(agg.failureCategories['token_limit']).toBe(1);

      // Weekly budget tracking
      expect(agg.budget.weeklyCeilingTokens).toBe(8_750_000);
      expect(agg.budget.usedTokens).toBe(400_000);
      expect(agg.budget.status).toBe('HEALTHY');
    });
  });

  describe('emitTelemetry', () => {
    it('successfully posts telemetry event to webhook endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"status":"received"}'),
      });

      const event: RoutineTelemetrySummary = {
        schemaVersion: '1.0.0',
        routine: 'autowork',
        timestamp: '2026-08-26T12:00:00Z',
        repository: 'owner/repo',
        result: 'SUCCESS',
        inputTokens: 50000,
        outputTokens: 2000,
        totalTokens: 52000,
        estimatedCost: 0.15,
      };

      const result = await emitTelemetry(event, 'https://telemetry.example.com/api/events', mockFetch as any);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://telemetry.example.com/api/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(event),
        })
      );
    });

    it('handles network error gracefully without throwing', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const event: RoutineTelemetrySummary = {
        schemaVersion: '1.0.0',
        routine: 'autowork',
        timestamp: '2026-08-26T12:00:00Z',
        repository: 'owner/repo',
        result: 'SUCCESS',
        inputTokens: 50000,
        outputTokens: 2000,
        totalTokens: 52000,
        estimatedCost: 0.15,
      };

      const result = await emitTelemetry(event, 'https://broken.endpoint/api', mockFetch as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('renderTelemetryDashboard', () => {
    it('renders text and JSON formats of fleet telemetry', () => {
      const events: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'autowork',
          timestamp: '2026-08-26T12:00:00Z',
          repository: 'owner/repo',
          result: 'SUCCESS',
          inputTokens: 50000,
          outputTokens: 2000,
          totalTokens: 52000,
          estimatedCost: 0.15,
        },
      ];
      const aggregated = aggregateFleetTelemetry(events);

      const text = stripAnsi(renderTelemetryDashboard(aggregated, { json: false }));
      expect(text).toContain('Fleet Telemetry Hub');
      expect(text).toContain('Weekly Token Budget Ceiling');
      expect(text).toContain('HEALTHY');

      const jsonStr = renderTelemetryDashboard(aggregated, { json: true });
      const parsed = JSON.parse(jsonStr);
      expect(parsed.totalRuns).toBe(1);
      expect(parsed.budget.status).toBe('HEALTHY');
    });

    it('parses and displays Inquisitive Stance & Ambiguity Gate metrics', () => {
      const sampleAmbiguityLog = `
# Run Log
## Metadata
| Field | Value |
|-------|-------|
| Routine | \`autowork\` |
| Timestamp | \`2026-09-04T12:00:00Z\` |
| Result | \`SUCCESS\` |
| Error reason | N/A |
| Input tokens | 12000 |
| Output tokens | 800 |
| Estimated cost | $0.03 |
| Iterations used | 4 / 65 |

## Execution trace
Step 12: Ambiguity & Missing Acceptance Criteria Gate triggered on issue #105.
Clarifications Needed Before Implementation:
1. What is the target latency threshold?
2. Which module should be updated?

Releasing claim and applying needs-info label.
`;

      const parsed = parseLogToTelemetry(sampleAmbiguityLog);
      expect(parsed?.ambiguityGateTriggered).toBe(true);
      expect(parsed?.needsInfoApplied).toBe(true);
      expect(parsed?.questionsAskedCount).toBe(2);

      const aggregated = aggregateFleetTelemetry([parsed!]);
      expect(aggregated.ambiguity.totalAmbiguityGatesTriggered).toBe(1);
      expect(aggregated.ambiguity.totalQuestionsAsked).toBe(2);
      expect(aggregated.ambiguity.needsInfoAppliedCount).toBe(1);
      expect(aggregated.ambiguity.estimatedTokensSaved).toBe(50_000);

      const text = stripAnsi(renderTelemetryDashboard(aggregated));
      expect(text).toContain('Inquisitive Stance & Ambiguity Gate Signals');
      expect(text).toContain('Ambiguity Gate Triggers:    1 runs stopped to request clarification');
      expect(text).toContain('Clarifying Questions Posed: 2 targeted questions');
      expect(text).toContain('Est. Wasted Tokens Averted: ~50.0k tokens');
    });

    it('collects local telemetry logs from .jonah-fleet/runs directory', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-telemetry-test-'));
      try {
        const runsDir = path.join(tempDir, '.jonah-fleet', 'runs');
        fs.mkdirSync(runsDir, { recursive: true });
        fs.writeFileSync(path.join(runsDir, 'autowork-2026-09-13T12-00-00Z.md'), sampleSuccessLog, 'utf8');

        const summaries = collectLocalTelemetryLogs(tempDir, 'test-repo');
        expect(summaries.length).toBe(1);
        expect(summaries[0].routine).toBe('autowork');
        expect(summaries[0].repository).toBe('test-repo');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('collects remote telemetry from GitHub issues labeled routine-log', async () => {
      const mockExecutor = vi.fn().mockResolvedValue(
        JSON.stringify([
          {
            number: 120,
            title: '[autowork] run 2026-09-13',
            body: sampleSuccessLog,
            createdAt: '2026-09-13T12:00:00Z',
          },
        ])
      );

      const summaries = await collectRepoTelemetry('owner/test-repo', mockExecutor);
      expect(mockExecutor).toHaveBeenCalledWith([
        'issue',
        'list',
        '--repo',
        'owner/test-repo',
        '--label',
        'routine-log',
        '--state',
        'all',
        '--limit',
        '25',
        '--json',
        'body,number,title,createdAt',
      ]);
      expect(summaries.length).toBe(1);
      expect(summaries[0].routine).toBe('autowork');
      expect(summaries[0].result).toBe('SUCCESS');
    });
  });

  describe('Actual Plan Quota (Google Antigravity)', () => {
    const sampleAgyJsonOutput = JSON.stringify({
      conversation_id: '',
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          description:
            'Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens.',
          groups: [
            {
              name: 'Gemini Models',
              description: 'Models within this group: Gemini Flash, Gemini Pro',
              buckets: [
                {
                  id: 'gemini-weekly',
                  name: 'Weekly Limit Remaining',
                  description: 'You have used some of your weekly limit',
                  window: 'weekly',
                  remaining_fraction: 0.16182342,
                  reset_time: '2026-10-07T04:44:43Z',
                },
                {
                  id: 'gemini-5h',
                  name: 'Five Hour Limit Remaining',
                  description: 'You have used some of your 5-hour limit',
                  window: '5h',
                  remaining_fraction: 0.4300806,
                  reset_time: '2026-10-03T10:20:55Z',
                },
              ],
            },
            {
              name: 'Claude and GPT models',
              description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
              buckets: [
                {
                  id: '3p-weekly',
                  name: 'Weekly Limit Remaining',
                  window: 'weekly',
                  remaining_fraction: 1.0,
                  reset_time: '2026-10-10T07:50:57Z',
                },
                {
                  id: '3p-5h',
                  name: 'Five Hour Limit Remaining',
                  window: '5h',
                  remaining_fraction: 1.0,
                  reset_time: '2026-10-03T12:50:57Z',
                },
              ],
            },
          ],
        },
      },
    });

    it('parses structured JSON quota output from agy --output-format json --print /quota', () => {
      const quota = parseAgyQuotaOutput(sampleAgyJsonOutput);

      expect(quota.available).toBe(true);
      expect(quota.description).toContain('Within each group');
      expect(quota.geminiWeeklyRemainingPct).toBeCloseTo(16.18, 1);
      expect(quota.gemini5hRemainingPct).toBeCloseTo(43.01, 1);
      expect(quota.geminiWeeklyResetTime).toBe('2026-10-07T04:44:43Z');
      expect(quota.gemini5hResetTime).toBe('2026-10-03T10:20:55Z');
      expect(quota.claudeWeeklyRemainingPct).toBe(100.0);
      expect(quota.claude5hRemainingPct).toBe(100.0);
      expect(quota.claudeWeeklyResetTime).toBe('2026-10-10T07:50:57Z');
      expect(quota.claude5hResetTime).toBe('2026-10-03T12:50:57Z');

      expect(quota.groups['Gemini Models']).toBeDefined();
      expect(quota.groups['Gemini Models'].buckets.length).toBe(2);
      expect(quota.groups['Claude and GPT models']).toBeDefined();
    });

    it('parses plain text tabular quota output as fallback', () => {
      const textOutput = `
Quota:
Gemini Models          Weekly Limit Remaining     16%   2026-10-07 06:44 CEST
Gemini Models          Five Hour Limit Remaining  44%   2026-10-03 12:20 CEST
Claude and GPT models  Weekly Limit Remaining     100%  2026-10-10 09:48 CEST
Claude and GPT models  Five Hour Limit Remaining  100%  2026-10-03 14:48 CEST
`;
      const quota = parseAgyQuotaOutput(textOutput);
      expect(quota.available).toBe(true);
      expect(quota.geminiWeeklyRemainingPct).toBe(16);
      expect(quota.gemini5hRemainingPct).toBe(44);
      expect(quota.claudeWeeklyRemainingPct).toBe(100);
      expect(quota.claude5hRemainingPct).toBe(100);
      expect(quota.geminiWeeklyResetTime).toBe('2026-10-07 06:44 CEST');
      expect(quota.claudeWeeklyResetTime).toBe('2026-10-10 09:48 CEST');
      expect(quota.claude5hResetTime).toBe('2026-10-03 14:48 CEST');
    });

    it('returns unavailable when output is empty or errors', () => {
      const empty = parseAgyQuotaOutput('');
      expect(empty.available).toBe(false);
      expect(empty.groups).toEqual({});

      const errorOutput = parseAgyQuotaOutput('Error: You are not logged into Antigravity');
      expect(errorOutput.available).toBe(false);
      expect(errorOutput.error?.toLowerCase()).toContain('not logged in');
    });

    it('caches plan quota to disk and reuses valid cache within TTL', () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-quota-cache-'));
      try {
        let executionCount = 0;
        const mockExecutor = () => {
          executionCount++;
          return sampleAgyJsonOutput;
        };

        // First call: executes command and writes cache
        const quota1 = getActualPlanQuotaSync({ repoRoot: tmpRepo, executor: mockExecutor, cacheTtlMs: 5000 });
        expect(quota1.available).toBe(true);
        expect(executionCount).toBe(1);

        // Verify cache file was written
        const cachePath = path.join(tmpRepo, '.jonah-fleet', 'plan-quota-cache.json');
        expect(fs.existsSync(cachePath)).toBe(true);

        // Second call: reads from cache without re-executing
        const quota2 = getActualPlanQuotaSync({ repoRoot: tmpRepo, executor: mockExecutor, cacheTtlMs: 5000 });
        expect(quota2.available).toBe(true);
        expect(executionCount).toBe(1); // Still 1!

        // Third call with 0 TTL: forces refresh
        const quota3 = getActualPlanQuotaSync({ repoRoot: tmpRepo, executor: mockExecutor, cacheTtlMs: 0 });
        expect(quota3.available).toBe(true);
        expect(executionCount).toBe(2);
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it('fetches plan quota asynchronously via fetchActualPlanQuota', async () => {
      const mockExecutor = vi.fn().mockResolvedValue(sampleAgyJsonOutput);
      const quota = await fetchActualPlanQuota({ executor: mockExecutor });
      expect(quota.available).toBe(true);
      expect(quota.geminiWeeklyRemainingPct).toBeCloseTo(16.18, 1);
    });

    it('formats a clean summary for terminal cards and CLI status', () => {
      const quota = parseAgyQuotaOutput(sampleAgyJsonOutput);
      const summary = stripAnsi(formatPlanQuotaSummary(quota));

      expect(summary).toContain('Gemini 5h: 43.0% remaining');
      expect(summary).toContain('Weekly: 16.2% remaining');
      expect(summary).toContain('Claude/GPT 5h: 100.0% remaining');
      expect(summary).toContain('Weekly: 100.0% remaining');
    });

    it('formats plan quota summary correctly when only weekly or 5h percentages exist', () => {
      const claudeWeeklyOnly = {
        available: true,
        groups: {},
        claudeWeeklyRemainingPct: 85.0,
        fetchedAt: new Date().toISOString(),
      };
      expect(stripAnsi(formatPlanQuotaSummary(claudeWeeklyOnly))).toBe('Claude/GPT Weekly: 85.0% remaining');

      const geminiWeeklyOnly = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 50.0,
        fetchedAt: new Date().toISOString(),
      };
      expect(stripAnsi(formatPlanQuotaSummary(geminiWeeklyOnly))).toBe('Gemini Weekly: 50.0% remaining');
    });

    it('formats plan quota summary with markdown backticks and br delimiter when markdown option is true', () => {
      const quota = parseAgyQuotaOutput(sampleAgyJsonOutput);
      const markdownSummary = formatPlanQuotaSummary(quota, { markdown: true });
      expect(markdownSummary).toContain('Gemini 5h: `43.0% remaining` · Weekly: `16.2% remaining`');
      expect(markdownSummary).toContain('<br>');
      expect(markdownSummary).toContain('Claude/GPT 5h: `100.0% remaining` · Weekly: `100.0% remaining`');
    });
  });

  describe('detectTokenAnomalies & Local Run Artifacts', () => {
    it('detects Context Asymmetry when input/output ratio exceeds 35:1', () => {
      const summaries: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'autowork',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 120,
          iterationsUsed: 10,
          maxIterations: 65,
          result: 'SUCCESS',
          inputTokens: 90000,
          outputTokens: 1500, // 60:1 ratio
          totalTokens: 91500,
          estimatedCost: 0.25,
        },
      ];
      const aggregated = aggregateFleetTelemetry(summaries);
      const anomalies = detectTokenAnomalies(aggregated);

      const asymmetry = anomalies.find((a) => a.type === 'context_asymmetry');
      expect(asymmetry).toBeDefined();
      expect(asymmetry?.routine).toBe('autowork');
      expect(asymmetry?.message).toContain('60.0:1');
      expect(asymmetry?.remediation).toMatch(/skill pruning|progressive disclosure/i);
    });

    it('detects Multi-Routine Budget Cannibalization when top-2 routines consume >80% of fleet tokens', () => {
      const summaries: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'autowork',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 100,
          iterationsUsed: 10,
          maxIterations: 65,
          result: 'SUCCESS',
          inputTokens: 40000,
          outputTokens: 2000,
          totalTokens: 42000, // 42%
          estimatedCost: 0.1,
        },
        {
          schemaVersion: '1.0.0',
          routine: 'peer-review',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 100,
          iterationsUsed: 10,
          maxIterations: 30,
          result: 'SUCCESS',
          inputTokens: 42000,
          outputTokens: 2000,
          totalTokens: 44000, // 44% => combined 86%
          estimatedCost: 0.1,
        },
        {
          schemaVersion: '1.0.0',
          routine: 'issues-housekeeping',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 50,
          iterationsUsed: 5,
          maxIterations: 20,
          result: 'SUCCESS',
          inputTokens: 13000,
          outputTokens: 1000,
          totalTokens: 14000, // 14%
          estimatedCost: 0.03,
        },
      ];
      const aggregated = aggregateFleetTelemetry(summaries);
      const anomalies = detectTokenAnomalies(aggregated);

      const cannibalization = anomalies.find((a) => a.type === 'multi_routine_cannibalization');
      expect(cannibalization).toBeDefined();
      expect(cannibalization?.message).toContain('86.0%');
    });

    it('detects Plan Quota Velocity anomaly when actual plan quota remaining is <30%', () => {
      const summaries: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'autowork',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 100,
          iterationsUsed: 10,
          maxIterations: 65,
          result: 'SUCCESS',
          inputTokens: 10000,
          outputTokens: 1000,
          totalTokens: 11000,
          estimatedCost: 0.05,
        },
      ];
      const aggregated = aggregateFleetTelemetry(summaries);
      const quota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 15.4,
        gemini5hRemainingPct: 35.8,
        fetchedAt: new Date().toISOString(),
      };
      const anomalies = detectTokenAnomalies(aggregated, { actualQuota: quota });

      const planAnomaly = anomalies.find((a) => a.type === 'plan_quota_velocity');
      expect(planAnomaly).toBeDefined();
      expect(planAnomaly?.severity).toBe('CRITICAL');
      expect(planAnomaly?.message).toContain('15.4%');
    });

    it('collects local telemetry from .jonah-fleet/runs/*.json files directly', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-telemetry-test-'));
      const runsDir = path.join(tempDir, '.jonah-fleet', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });

      const jsonRun = {
        routine: 'peer-review',
        timestamp: '2026-10-03T08:32:11.038Z',
        exitCode: 0,
        success: true,
        target: 'PR #625',
        durationMs: 120000,
        usage: {
          inputTokens: 50000,
          outputTokens: 2000,
          thinkingTokens: 1000,
          totalTokens: 52000,
        },
      };
      fs.writeFileSync(path.join(runsDir, 'peer-review-test.json'), JSON.stringify(jsonRun, null, 2));

      const collected = collectLocalTelemetryLogs(tempDir, 'test-repo');
      expect(collected.length).toBe(1);
      expect(collected[0].routine).toBe('peer-review');
      expect(collected[0].inputTokens).toBe(50000);
      expect(collected[0].outputTokens).toBe(2000);
      expect(collected[0].totalTokens).toBe(52000);
      expect(collected[0].result).toBe('SUCCESS');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('does not trigger Multi-Routine Budget Cannibalization on a 2-routine fleet', () => {
      const summaries: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'autowork',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 100,
          iterationsUsed: 10,
          maxIterations: 65,
          result: 'SUCCESS',
          inputTokens: 50000,
          outputTokens: 2000,
          totalTokens: 52000,
          estimatedCost: 0.1,
        },
        {
          schemaVersion: '1.0.0',
          routine: 'peer-review',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 100,
          iterationsUsed: 10,
          maxIterations: 30,
          result: 'SUCCESS',
          inputTokens: 50000,
          outputTokens: 2000,
          totalTokens: 52000,
          estimatedCost: 0.1,
        },
      ];
      const aggregated = aggregateFleetTelemetry(summaries);
      const anomalies = detectTokenAnomalies(aggregated);
      const cannibalization = anomalies.find((a) => a.type === 'multi_routine_cannibalization');
      expect(cannibalization).toBeUndefined();
    });

    it('evaluates both weekly and 5h rolling plan quotas independently without masking', () => {
      const summaries: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'autowork',
          repository: 'test/repo',
          timestamp: new Date().toISOString(),
          durationSeconds: 100,
          iterationsUsed: 10,
          maxIterations: 65,
          result: 'SUCCESS',
          inputTokens: 10000,
          outputTokens: 1000,
          totalTokens: 11000,
          estimatedCost: 0.05,
        },
      ];
      const aggregated = aggregateFleetTelemetry(summaries);
      const quota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 28.0, // < 30%
        gemini5hRemainingPct: 5.0,      // < 20%
        claudeWeeklyRemainingPct: 25.0, // < 30%
        claude5hRemainingPct: 10.0,     // < 20%
        fetchedAt: new Date().toISOString(),
      };
      const anomalies = detectTokenAnomalies(aggregated, { actualQuota: quota });
      const planAnomalies = anomalies.filter((a) => a.type === 'plan_quota_velocity');

      // Both Gemini weekly and 5h rolling limits must be present (neither masked by else-if)
      const geminiWeekly = planAnomalies.find((a) => a.message.includes('Gemini weekly'));
      const gemini5h = planAnomalies.find((a) => a.message.includes('Gemini 5h'));
      expect(geminiWeekly).toBeDefined();
      expect(gemini5h).toBeDefined();

      // Claude quotas must also be evaluated
      const claudeWeekly = planAnomalies.find((a) => a.message.includes('Claude/GPT weekly'));
      const claude5h = planAnomalies.find((a) => a.message.includes('Claude/GPT 5h'));
      expect(claudeWeekly).toBeDefined();
      expect(claude5h).toBeDefined();
    });

    it('detects Unilateral Re-Review Thrash when a PR is evaluated >= 2 times on identical commit SHA', () => {
      const summaries: RoutineTelemetrySummary[] = [
        {
          schemaVersion: '1.0.0',
          routine: 'peer-review',
          repository: 'test/repo',
          timestamp: '2026-10-03T10:00:00Z',
          durationSeconds: 60,
          result: 'BOUNCED_TO_DRAFT',
          inputTokens: 20000,
          outputTokens: 1000,
          totalTokens: 21000,
          estimatedCost: 0.05,
          targetPr: 42,
          commitSha: '21e8e774f82fecc0bfab76c068dc72f2123de8b1',
        },
        {
          schemaVersion: '1.0.0',
          routine: 'peer-review',
          repository: 'test/repo',
          timestamp: '2026-10-03T10:30:00Z',
          durationSeconds: 60,
          result: 'BOUNCED_TO_DRAFT',
          inputTokens: 20000,
          outputTokens: 1000,
          totalTokens: 21000,
          estimatedCost: 0.05,
          targetPr: 42,
          commitSha: '21e8e774f82fecc0bfab76c068dc72f2123de8b1',
        },
      ];
      const aggregated = aggregateFleetTelemetry(summaries);
      const anomalies = detectTokenAnomalies(aggregated);
      const thrash = anomalies.find((a) => a.type === 'unilateral_rereview_thrash');
      expect(thrash).toBeDefined();
      expect(thrash?.severity).toBe('WARNING');
      expect(thrash?.routine).toBe('peer-review');
      expect(thrash?.message).toContain('PR #42');
      expect(thrash?.message).toContain('21e8e77');
    });

    it('prioritizes .json over .md when both coexist in runs directory and deduplicates', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-telemetry-dedup-test-'));
      const runsDir = path.join(tempDir, '.jonah-fleet', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });

      const baseName = 'peer-review-2026-10-03T11-00-00Z';
      const mdContent = `
# Run Log
## Metadata
| Field | Value |
|---|---|
| Routine | \`peer-review\` |
| Timestamp | \`2026-10-03T11:00:00Z\` |
| Result | \`SUCCESS\` |
| Input tokens | 30000 |
| Output tokens | 1000 |
| Duration | 90s |
| Target | \`PR #100\` |
| Commit | \`abcdef1\` |
`;
      const jsonRun = {
        routine: 'peer-review',
        timestamp: '2026-10-03T11:00:00Z',
        exitCode: 0,
        success: true,
        target: 'PR #100',
        pr: 100,
        commitSha: 'abcdef123456789',
        durationMs: 95400, // Exact machine duration
        usage: {
          inputTokens: 30000,
          outputTokens: 1000,
          thinkingTokens: 500,
          totalTokens: 31000,
        },
      };

      fs.writeFileSync(path.join(runsDir, `${baseName}.md`), mdContent, 'utf8');
      fs.writeFileSync(path.join(runsDir, `${baseName}.json`), JSON.stringify(jsonRun, null, 2), 'utf8');

      const collected = collectLocalTelemetryLogs(tempDir, 'test-repo');
      expect(collected.length).toBe(1);
      // Duration from JSON is Math.round(95400 / 1000) = 95s, whereas MD had 90s.
      // Prioritizing JSON yields 95.
      expect(collected[0].durationSeconds).toBe(95);
      expect(collected[0].targetPr).toBe(100);
      expect(collected[0].commitSha).toBe('abcdef123456789');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('formats I/O ratio safely with formatIoRatio helper', () => {
      expect(formatIoRatio(35000, 1000)).toBe('35:1');
      expect(formatIoRatio(35500, 1000, 1)).toBe('35.5:1');
      expect(formatIoRatio(100, 0)).toBe('100:1');
      expect(formatIoRatio(0, 0)).toBe('0:1');
    });

    it('exposes typed TOKEN_ANOMALY_THRESHOLDS constants with documented values', () => {
      expect(TOKEN_ANOMALY_THRESHOLDS.CONTEXT_ASYMMETRY_RATIO).toBe(35);
      expect(TOKEN_ANOMALY_THRESHOLDS.CONTEXT_ASYMMETRY_MIN_INPUT_TOKENS).toBe(50000);
      expect(TOKEN_ANOMALY_THRESHOLDS.BUDGET_HOG_PERCENT).toBe(75);
      expect(TOKEN_ANOMALY_THRESHOLDS.MULTI_ROUTINE_CANNIBALIZATION_PERCENT).toBe(80);
      expect(TOKEN_ANOMALY_THRESHOLDS.MULTI_ROUTINE_MIN_ROUTINES).toBe(3);
      expect(TOKEN_ANOMALY_THRESHOLDS.ITERATION_EXHAUSTION_PERCENT).toBe(20);
      expect(TOKEN_ANOMALY_THRESHOLDS.PLAN_QUOTA_WEEKLY_WARNING_PERCENT).toBe(30);
      expect(TOKEN_ANOMALY_THRESHOLDS.PLAN_QUOTA_WEEKLY_CRITICAL_PERCENT).toBe(20);
      expect(TOKEN_ANOMALY_THRESHOLDS.PLAN_QUOTA_5H_CRITICAL_PERCENT).toBe(20);
      expect(TOKEN_ANOMALY_THRESHOLDS.RE_REVIEW_THRASH_THRESHOLD).toBe(2);
    });
  });
});

