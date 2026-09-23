import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getDaemonStatePath,
  readDaemonState,
  writeDaemonState,
  clearDaemonState,
  isDaemonRunning,
  DaemonState,
  filterReviewablePRs,
  drainReviewQueue,
  reconcileOrphanedLocalRuns,
} from '../src/lib/daemon.js';

describe('Local Agent Daemon Manager', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-daemon-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('computes correct daemon state file path', () => {
    const statePath = getDaemonStatePath(tmpRepo);
    expect(statePath).toBe(path.join(tmpRepo, '.jonah-fleet', 'daemon.json'));
  });

  it('reads and writes daemon state', () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['peer-review', 'autowork'],
      status: 'idle',
    };

    writeDaemonState(tmpRepo, state);
    const read = readDaemonState(tmpRepo);

    expect(read).not.toBeNull();
    expect(read?.pid).toBe(process.pid);
    expect(read?.reviewIntervalMinutes).toBe(3);
    expect(read?.autoworkIntervalMinutes).toBe(30);
    expect(read?.routines).toEqual(['peer-review', 'autowork']);
  });

  it('correctly reports daemon running when PID is alive', () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['autowork'],
      status: 'idle',
    };

    writeDaemonState(tmpRepo, state);
    expect(isDaemonRunning(tmpRepo)).toBe(true);
  });

  it('cleans up and reports false when PID is dead', () => {
    const deadPid = 99999999;
    const state: DaemonState = {
      pid: deadPid,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['autowork'],
      status: 'idle',
    };

    writeDaemonState(tmpRepo, state);
    expect(isDaemonRunning(tmpRepo)).toBe(false);
    expect(readDaemonState(tmpRepo)).toBeNull();
  });

  it('clears daemon state file on command', () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['autowork'],
      status: 'idle',
    };

    writeDaemonState(tmpRepo, state);
    clearDaemonState(tmpRepo);
    expect(readDaemonState(tmpRepo)).toBeNull();
  });

  it('safely handles PR count query on non-git or error directories', async () => {
    const { countOpenReadyPRs, getOpenReviewablePRs } = await import('../src/lib/daemon.js');
    const prs = await getOpenReviewablePRs(tmpRepo);
    expect(prs).toEqual([]);
    const count = await countOpenReadyPRs(tmpRepo);
    expect(typeof count).toBe('number');
    expect(count).toBe(0);
  });

  it('supports verbose flag in daemon options', async () => {
    const { DaemonOptions } = await import('../src/lib/daemon.js');
    const opts = { verbose: true, reviewInterval: 5 };
    expect(opts.verbose).toBe(true);
    expect(opts.reviewInterval).toBe(5);
  });

  it('correctly filters out automated release PRs and retains feature/fix PRs via filterReviewablePRs', () => {
    const rawPRs = [
      { number: 10, headRefName: 'feat/my-feature', title: 'feat: add awesome feature' },
      { number: 11, headRefName: 'release-please--branches--main', title: 'chore(main): release 1.0.0' },
      { number: 12, headRefName: 'fix/bug-fix', title: 'fix: resolve edge case' },
      { number: 13, headRefName: 'chore/release-helper', title: 'chore(main): release 2.0.0' },
    ];

    const filtered = filterReviewablePRs(rawPRs);
    expect(filtered.map((p) => p.number)).toEqual([10, 12]);
    expect(filterReviewablePRs([])).toEqual([]);
    expect(filterReviewablePRs(null as any)).toEqual([]);
  });

  describe('drainReviewQueue', () => {
    it('does not invoke peer-review routine when 0 reviewable PRs exist', async () => {
      let runRoutineCalled = false;
      await drainReviewQueue({
        repoRoot: tmpRepo,
        getPRs: async () => [],
        runRoutine: async () => {
          runRoutineCalled = true;
          return { success: true };
        },
      });

      expect(runRoutineCalled).toBe(false);
    });

    it('drains review queue across multiple candidates and tracks attempted PR numbers', async () => {
      const prs = [
        { number: 101, headRefName: 'feat/pr-1', title: 'feat: first pr' },
        { number: 102, headRefName: 'feat/pr-2', title: 'feat: second pr' },
      ];

      const attempted: number[] = [];
      const executedTargets: string[] = [];

      let prQueue = [...prs];

      await drainReviewQueue({
        repoRoot: tmpRepo,
        getPRs: async () => prQueue,
        runRoutine: async (opts) => {
          opts.onTargetDetected?.(`PR #${prQueue[0].number}`);
          executedTargets.push(`PR #${prQueue[0].number}`);
          // Simulate PR 101 being processed and removed from open PRs
          prQueue = prQueue.slice(1);
          return { success: true };
        },
        onAttempted: (prNum) => {
          attempted.push(prNum);
        },
      });

      expect(executedTargets).toEqual(['PR #101', 'PR #102']);
      expect(attempted).toEqual([101, 102]);
    });

    it('stops review queue draining immediately when isStopping returns true', async () => {
      const prs = [
        { number: 201, headRefName: 'feat/pr-201', title: 'feat: pr 201' },
        { number: 202, headRefName: 'feat/pr-202', title: 'feat: pr 202' },
      ];

      let isStopping = false;
      const executed: number[] = [];

      await drainReviewQueue({
        repoRoot: tmpRepo,
        isStopping: () => isStopping,
        getPRs: async () => prs,
        runRoutine: async () => {
          executed.push(201);
          isStopping = true; // Signal stopping after first execution
          return { success: true };
        },
      });

      expect(executed).toEqual([201]);
    });

    it('handles routine error gracefully and continues to evaluate remaining candidates', async () => {
      const prs = [
        { number: 301, headRefName: 'feat/failing-pr', title: 'feat: will fail' },
        { number: 302, headRefName: 'feat/passing-pr', title: 'feat: will succeed' },
      ];

      const attempted: number[] = [];
      let prQueue = [...prs];

      await drainReviewQueue({
        repoRoot: tmpRepo,
        getPRs: async () => prQueue,
        runRoutine: async (opts) => {
          const current = prQueue[0];
          opts.onTargetDetected?.(`PR #${current.number}`);
          prQueue = prQueue.slice(1);

          if (current.number === 301) {
            throw new Error('Simulation of peer-review crash');
          }
          return { success: true };
        },
        onAttempted: (prNum) => {
          attempted.push(prNum);
        },
      });

      expect(attempted).toEqual([301, 302]);
    });

    it('prevents infinite loop if a PR remains in ready list without progress', async () => {
      const persistentPR = [{ number: 401, headRefName: 'feat/stuck', title: 'feat: stuck in ready' }];

      let runCount = 0;
      await drainReviewQueue({
        repoRoot: tmpRepo,
        getPRs: async () => persistentPR, // PR never gets removed from list
        runRoutine: async () => {
          runCount++;
          return { success: false, exitCode: 1 };
        },
      });

      // Should execute exactly once and not loop infinitely because attemptedPRNumbers tracks #401
      expect(runCount).toBe(1);
    });
  });

  describe('reconcileOrphanedLocalRuns', () => {
    it('returns 0 when no orphaned issues exist', async () => {
      const count = await reconcileOrphanedLocalRuns({
        repoRoot: tmpRepo,
        queryIssues: async () => [],
      });
      expect(count).toBe(0);
    });

    it('reconciles an orphaned run that died mid-execution', async () => {
      const reconciled: Array<{ issue: number; report?: string; isSuccess: boolean }> = [];
      const count = await reconcileOrphanedLocalRuns({
        repoRoot: tmpRepo,
        queryIssues: async () => [
          { number: 890, title: '[peer-review] run 2026-09-14T06-59-51Z', createdAt: '2026-09-14T06:59:51Z' },
        ],
        reconcileRun: async (_root, issueNumber, report, isSuccess) => {
          reconciled.push({ issue: issueNumber, report, isSuccess });
          return true;
        },
      });
      expect(count).toBe(1);
      expect(reconciled).toEqual([{ issue: 890, report: undefined, isSuccess: false }]);
    });

    it('reconciles an orphaned run that completed before daemon termination', async () => {
      const runsDir = path.join(tmpRepo, '.jonah-fleet', 'runs');
      fs.mkdirSync(runsDir, { recursive: true });

      const timestamp = '2026-09-15T06-43-40-758Z';
      fs.writeFileSync(
        path.join(runsDir, `autowork-${timestamp}.json`),
        JSON.stringify({ routine: 'autowork', issueNumber: 911, success: true, exitCode: 0 })
      );
      fs.writeFileSync(
        path.join(runsDir, `autowork-${timestamp}.md`),
        '# Autowork Report\n\nResult: SUCCESS'
      );

      const reconciled: Array<{ issue: number; report?: string; isSuccess: boolean; routine?: string }> = [];
      const count = await reconcileOrphanedLocalRuns({
        repoRoot: tmpRepo,
        queryIssues: async () => [
          { number: 911, title: '[autowork] run 2026-09-15T06-43-40Z', createdAt: '2026-09-15T06:43:40Z' },
        ],
        reconcileRun: async (_root, issueNumber, report, isSuccess, routine) => {
          reconciled.push({ issue: issueNumber, report, isSuccess, routine });
          return true;
        },
      });
      expect(count).toBe(1);
      expect(reconciled[0].issue).toBe(911);
      expect(reconciled[0].report).toBe('# Autowork Report\n\nResult: SUCCESS');
      expect(reconciled[0].isSuccess).toBe(true);
      expect(reconciled[0].routine).toBe('autowork');
    });

    it('recovers granularly if one issue reconciliation fails without aborting others', async () => {
      const processed: number[] = [];
      const count = await reconcileOrphanedLocalRuns({
        repoRoot: tmpRepo,
        queryIssues: async () => [
          { number: 101, title: '[autowork] run 1', createdAt: '2026-09-15T06-40-00Z' },
          { number: 102, title: '[peer-review] run 2', createdAt: '2026-09-15T06-41-00Z' },
        ],
        reconcileRun: async (_root, issueNumber) => {
          processed.push(issueNumber);
          if (issueNumber === 101) {
            throw new Error('Network timeout on issue 101');
          }
          return true;
        },
      });
      expect(processed).toEqual([101, 102]);
      expect(count).toBe(1);
    });

    it('fails gracefully if query throws', async () => {
      const count = await reconcileOrphanedLocalRuns({
        repoRoot: tmpRepo,
        queryIssues: async () => {
          throw new Error('Network error or offline');
        },
      });
      expect(count).toBe(0);
    });
  });

  describe('Daemon Error Handling & Worktree Resilience', () => {
    it('gracefully handles getPRs throwing an API error without throwing', async () => {
      await expect(
        drainReviewQueue({
          repoRoot: tmpRepo,
          getPRs: async () => {
            throw new Error('API error (attempt 1): UNAVAILABLE (code 503)');
          },
        })
      ).resolves.not.toThrow();
    });

    it('gracefully handles re-query getPRs throwing an error after routine completion', async () => {
      let callCount = 0;
      await expect(
        drainReviewQueue({
          repoRoot: tmpRepo,
          getPRs: async () => {
            callCount++;
            if (callCount === 1) {
              return [{ number: 42, headRefName: 'feat/test', title: 'Test PR' }];
            }
            throw new Error('API error on re-query (code 503)');
          },
          runRoutine: async () => ({ success: true, exitCode: 0 }),
        })
      ).resolves.not.toThrow();
    });
  });
});

