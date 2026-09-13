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
});

