import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  checkPlanQuotaDepletion,
  ActualPlanQuota,
} from '../src/lib/telemetry.js';
import {
  checkDaemonQuotaGuard,
  isFullBurnEnabled,
  runDaemonLoop,
  drainReviewQueue,
  performAutoworkScan,
  startBackgroundDaemon,
  writeDaemonState,
  readDaemonState,
  DaemonState,
} from '../src/lib/daemon.js';

describe('Daemon Quota Guard (<20% limit & full-burn override)', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-quota-guard-test-'));
    delete process.env.JONAH_FLEET_FULL_BURN;
    delete process.env.FULL_BURN;
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    delete process.env.JONAH_FLEET_FULL_BURN;
    delete process.env.FULL_BURN;
  });

  describe('checkPlanQuotaDepletion', () => {
    it('returns depleted: true when 5h quota is <20%', () => {
      const quota: ActualPlanQuota = {
        available: true,
        groups: {
          'Gemini Models': {
            name: 'Gemini Models',
            buckets: [],
            weeklyRemainingPct: 50,
            window5hRemainingPct: 18.5,
            window5hResetTime: '2026-10-08T12:00:00Z',
          },
        },
        geminiWeeklyRemainingPct: 50,
        gemini5hRemainingPct: 18.5,
        gemini5hResetTime: '2026-10-08T12:00:00Z',
        fetchedAt: new Date().toISOString(),
      };

      const result = checkPlanQuotaDepletion(quota);
      expect(result.depleted).toBe(true);
      expect(result.window).toBe('5h');
      expect(result.remainingPct).toBe(18.5);
      expect(result.thresholdPct).toBe(20);
      expect(result.resetTime).toBe('2026-10-08T12:00:00Z');
      expect(result.message).toContain('18.5% remaining (<20% floor)');
    });

    it('returns depleted: true when 7days (weekly) quota is <20%', () => {
      const quota: ActualPlanQuota = {
        available: true,
        groups: {
          'Gemini Models': {
            name: 'Gemini Models',
            buckets: [],
            weeklyRemainingPct: 16.2,
            weeklyResetTime: '2026-10-15T00:00:00Z',
            window5hRemainingPct: 60,
          },
        },
        geminiWeeklyRemainingPct: 16.2,
        geminiWeeklyResetTime: '2026-10-15T00:00:00Z',
        gemini5hRemainingPct: 60,
        fetchedAt: new Date().toISOString(),
      };

      const result = checkPlanQuotaDepletion(quota);
      expect(result.depleted).toBe(true);
      expect(result.window).toBe('7days');
      expect(result.remainingPct).toBe(16.2);
      expect(result.resetTime).toBe('2026-10-15T00:00:00Z');
      expect(result.message).toContain('16.2% remaining (<20% floor)');
    });

    it('returns depleted: true when both 5h and 7days quotas are <20%', () => {
      const quota: ActualPlanQuota = {
        available: true,
        groups: {
          'Gemini Models': {
            name: 'Gemini Models',
            buckets: [],
            weeklyRemainingPct: 12.0,
            weeklyResetTime: '2026-10-15T00:00:00Z',
            window5hRemainingPct: 10.0,
            window5hResetTime: '2026-10-08T12:00:00Z',
          },
        },
        geminiWeeklyRemainingPct: 12.0,
        geminiWeeklyResetTime: '2026-10-15T00:00:00Z',
        gemini5hRemainingPct: 10.0,
        gemini5hResetTime: '2026-10-08T12:00:00Z',
        fetchedAt: new Date().toISOString(),
      };

      const result = checkPlanQuotaDepletion(quota);
      expect(result.depleted).toBe(true);
      expect(result.remainingPct).toBe(10.0);
      expect(result.message).toContain('both 5h (10.0%) and 7days (12.0%)');
    });

    it('returns depleted: false when both 5h and weekly quotas are >=20%', () => {
      const quota: ActualPlanQuota = {
        available: true,
        groups: {
          'Gemini Models': {
            name: 'Gemini Models',
            buckets: [],
            weeklyRemainingPct: 20.0,
            window5hRemainingPct: 25.0,
          },
        },
        geminiWeeklyRemainingPct: 20.0,
        gemini5hRemainingPct: 25.0,
        fetchedAt: new Date().toISOString(),
      };

      const result = checkPlanQuotaDepletion(quota);
      expect(result.depleted).toBe(false);
    });

    it('evaluates Claude model group when model is specified as claude', () => {
      const quota: ActualPlanQuota = {
        available: true,
        groups: {
          'Gemini Models': {
            name: 'Gemini Models',
            buckets: [],
            weeklyRemainingPct: 5.0,
            window5hRemainingPct: 5.0,
          },
          'Claude and GPT models': {
            name: 'Claude and GPT models',
            buckets: [],
            weeklyRemainingPct: 80.0,
            window5hRemainingPct: 90.0,
          },
        },
        geminiWeeklyRemainingPct: 5.0,
        gemini5hRemainingPct: 5.0,
        claudeWeeklyRemainingPct: 80.0,
        claude5hRemainingPct: 90.0,
        fetchedAt: new Date().toISOString(),
      };

      // When running claude model, gemini quota being low does not stop the daemon
      const claudeResult = checkPlanQuotaDepletion(quota, { model: 'claude-3-5-sonnet' });
      expect(claudeResult.depleted).toBe(false);

      // Default model (gemini) trips because gemini quota is low
      const defaultResult = checkPlanQuotaDepletion(quota);
      expect(defaultResult.depleted).toBe(true);
    });

    it('returns depleted: false if quota is unavailable', () => {
      const quota: ActualPlanQuota = {
        available: false,
        groups: {},
        fetchedAt: new Date().toISOString(),
      };
      expect(checkPlanQuotaDepletion(quota).depleted).toBe(false);
      expect(checkPlanQuotaDepletion(null).depleted).toBe(false);
      expect(checkPlanQuotaDepletion(undefined).depleted).toBe(false);
    });
  });

  describe('isFullBurnEnabled', () => {
    it('returns true when options.fullBurn is true', () => {
      expect(isFullBurnEnabled({ fullBurn: true })).toBe(true);
    });

    it('returns true when state.fullBurn is true', () => {
      const state: DaemonState = {
        pid: 123,
        startedAt: new Date().toISOString(),
        reviewIntervalMinutes: 3,
        autoworkIntervalMinutes: 30,
        routines: ['peer-review'],
        status: 'idle',
        fullBurn: true,
      };
      expect(isFullBurnEnabled({}, state)).toBe(true);
    });

    it('returns true when JONAH_FLEET_FULL_BURN=true env var is set', () => {
      process.env.JONAH_FLEET_FULL_BURN = 'true';
      expect(isFullBurnEnabled({})).toBe(true);
    });

    it('returns true when FULL_BURN=true env var is set', () => {
      process.env.FULL_BURN = 'true';
      expect(isFullBurnEnabled({})).toBe(true);
    });

    it('returns false by default', () => {
      expect(isFullBurnEnabled({})).toBe(false);
    });
  });

  describe('checkDaemonQuotaGuard', () => {
    it('returns shouldStop: true when quota is <20% and full burn is disabled', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 15,
        gemini5hRemainingPct: 40,
        fetchedAt: new Date().toISOString(),
      };

      const guard = await checkDaemonQuotaGuard(
        tmpRepo,
        {
          getPlanQuota: async () => lowQuota,
        }
      );

      expect(guard.shouldStop).toBe(true);
      expect(guard.depletion?.window).toBe('7days');
      expect(guard.depletion?.remainingPct).toBe(15);
    });

    it('returns shouldStop: false when quota is <20% but full burn is enabled', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 15,
        gemini5hRemainingPct: 40,
        fetchedAt: new Date().toISOString(),
      };

      const guard = await checkDaemonQuotaGuard(
        tmpRepo,
        {
          fullBurn: true,
          getPlanQuota: async () => lowQuota,
        }
      );

      expect(guard.shouldStop).toBe(false);
    });
  });

  describe('drainReviewQueue quota floor check', () => {
    it('aborts drain pass when quota drops below 20% and full burn is not set', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 12,
        gemini5hRemainingPct: 50,
        fetchedAt: new Date().toISOString(),
      };

      let routineRan = false;
      const onQuotaDepleted = vi.fn();

      await drainReviewQueue({
        repoRoot: tmpRepo,
        options: {
          getPlanQuota: async () => lowQuota,
        },
        getPRs: async () => [
          {
            number: 101,
            title: 'Fix edge case',
            headRefName: 'fix-1',
          },
        ],
        runRoutine: async () => {
          routineRan = true;
          return { success: true };
        },
        onQuotaDepleted,
      });

      expect(routineRan).toBe(false);
      expect(onQuotaDepleted).toHaveBeenCalledTimes(1);
    });

    it('proceeds with drain pass if quota is below 20% but full burn is true', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 12,
        gemini5hRemainingPct: 50,
        fetchedAt: new Date().toISOString(),
      };

      let routineRan = false;

      await drainReviewQueue({
        repoRoot: tmpRepo,
        options: {
          fullBurn: true,
          getPlanQuota: async () => lowQuota,
        },
        getPRs: async () => [
          {
            number: 101,
            title: 'Fix edge case',
            headRefName: 'fix-1',
          },
        ],
        runRoutine: async () => {
          routineRan = true;
          return { success: true };
        },
      });

      expect(routineRan).toBe(true);
    });
  });

  describe('performAutoworkScan quota floor check', () => {
    it('aborts autowork scan when quota is <20% and full burn is false', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 40,
        gemini5hRemainingPct: 14,
        fetchedAt: new Date().toISOString(),
      };

      let routineRan = false;
      const onQuotaDepleted = vi.fn();

      const result = await performAutoworkScan({
        repoRoot: tmpRepo,
        options: {
          getPlanQuota: async () => lowQuota,
        },
        getPRs: async () => [],
        getBacklog: async () => ({
          total: 1,
          actionable: [{ number: 42, title: 'Bug', labels: ['status:ready'] } as any],
          blocked: [],
          inFlight: [],
          needsInfo: [],
          unprioritized: [],
        }),
        runRoutine: async () => {
          routineRan = true;
          return { success: true };
        },
        onQuotaDepleted,
      });

      expect(result.executed).toBe(false);
      expect(result.reason).toBe('quota_depleted');
      expect(routineRan).toBe(false);
      expect(onQuotaDepleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('runDaemonLoop startup quota check', () => {
    it('stops immediately on startup when quota is <20% and full burn is false', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 10,
        gemini5hRemainingPct: 15,
        fetchedAt: new Date().toISOString(),
      };

      let reviewCalled = false;
      await runDaemonLoop(tmpRepo, {
        getPlanQuota: async () => lowQuota,
        getPRs: async () => {
          reviewCalled = true;
          return [];
        },
      });

      expect(reviewCalled).toBe(false);
      expect(readDaemonState(tmpRepo)).toBeNull();
    });
  });

  describe('Post-routine quota depletion check', () => {
    it('aborts subsequent PRs in drainReviewQueue when routine result shows quota dropped <20%', async () => {
      const healthyQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 25,
        gemini5hRemainingPct: 30,
        fetchedAt: new Date().toISOString(),
      };

      const depletedQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 18,
        gemini5hRemainingPct: 15,
        fetchedAt: new Date().toISOString(),
      };

      let runCount = 0;
      const onQuotaDepleted = vi.fn();

      await drainReviewQueue({
        repoRoot: tmpRepo,
        options: {
          getPlanQuota: async () => healthyQuota,
        },
        getPRs: async () => [
          { number: 1, title: 'PR 1', headRefName: 'b1' },
          { number: 2, title: 'PR 2', headRefName: 'b2' },
        ],
        runRoutine: async () => {
          runCount++;
          return {
            success: true,
            planQuota: depletedQuota,
          };
        },
        onQuotaDepleted,
      });

      expect(runCount).toBe(1);
      expect(onQuotaDepleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('KeyboardController full-burn keybinding', () => {
    it('invokes onToggleFullBurn when "b" or "B" is pressed', async () => {
      const { KeyboardController } = await import('../src/lib/daemon-keys.js');
      const onToggleFullBurn = vi.fn();
      const controller = new KeyboardController({ onToggleFullBurn });

      controller.handleKeypress('b');
      expect(onToggleFullBurn).toHaveBeenCalledTimes(1);

      controller.handleKeypress('B');
      expect(onToggleFullBurn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Manifest-driven full-burn configuration', () => {
    it('enables full burn when agents-manifest.json defines budgets.fullBurn: true', () => {
      fs.writeFileSync(
        path.join(tmpRepo, 'agents-manifest.json'),
        JSON.stringify({ budgets: { fullBurn: true } }, null, 2)
      );
      expect(isFullBurnEnabled({}, undefined, tmpRepo)).toBe(true);
    });

    it('enables full burn when agents-manifest.json defines daemon.fullBurn: true', () => {
      fs.writeFileSync(
        path.join(tmpRepo, 'agents-manifest.json'),
        JSON.stringify({ daemon: { fullBurn: true } }, null, 2)
      );
      expect(isFullBurnEnabled({}, undefined, tmpRepo)).toBe(true);
    });
  });

  describe('startBackgroundDaemon quota check', () => {
    it('refuses to start daemon in background if quota is <20% and full burn is false', async () => {
      const lowQuota: ActualPlanQuota = {
        available: true,
        groups: {},
        geminiWeeklyRemainingPct: 15,
        gemini5hRemainingPct: 10,
        fetchedAt: new Date().toISOString(),
      };

      await expect(
        startBackgroundDaemon(tmpRepo, {
          getPlanQuota: async () => lowQuota,
        })
      ).rejects.toThrow(/Plan quota is below 20%/);
    });
  });
});
