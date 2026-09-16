import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runLocalRoutine } from './runner.js';
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

const execFileAsync = promisify(execFile);

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
}

export interface DaemonOptions {
  interval?: number; // legacy fallback interval (minutes)
  reviewInterval?: number; // minutes (default: 3)
  autoworkInterval?: number; // minutes (default: 30)
  routines?: string[];
  model?: string;
  foreground?: boolean;
  verbose?: boolean;
  stdin?: any;
  getPRs?: (repoRoot: string) => Promise<ReviewablePR[]>;
  runRoutine?: (opts: any) => Promise<{ success: boolean; exitCode?: number }>;
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

export interface ReviewablePR {
  number: number;
  headRefName: string;
  title: string;
}

/**
 * Filters a list of pull requests to include only reviewable PRs,
 * excluding automated release-please branches and release PR titles.
 */
export function filterReviewablePRs(prs: ReviewablePR[]): ReviewablePR[] {
  return (prs || []).filter(
    (pr) =>
      pr &&
      typeof pr.number === 'number' &&
      !pr.headRefName?.startsWith('release-please--') &&
      !pr.title?.startsWith('chore(main): release')
  );
}

/**
 * Fast pre-flight check to query open ready PRs in ~100ms with 0 token cost,
 * excluding drafts, automated release-please branches, and release PR titles.
 */
export async function getOpenReviewablePRs(repoRoot: string): Promise<ReviewablePR[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'list', '--state', 'open', '--draft=false', '--json', 'number,headRefName,title'],
      { cwd: repoRoot }
    );
    const prs = JSON.parse(stdout) as ReviewablePR[];
    return filterReviewablePRs(prs);
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

/**
 * Starts the daemon in the background by detaching a child process.
 */
export async function startBackgroundDaemon(repoRoot: string, options: DaemonOptions = {}): Promise<DaemonState> {
  if (isDaemonRunning(repoRoot)) {
    const existing = readDaemonState(repoRoot);
    throw new Error(`Daemon is already running with PID ${existing?.pid}`);
  }

  const reviewInterval = options.reviewInterval || 3;
  const autoworkInterval = options.autoworkInterval || options.interval || 30;
  const routines = options.routines || ['peer-review', 'autowork'];

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

  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, JONAH_FLEET_DAEMON: 'true' },
  });

  child.unref();

  const state: DaemonState = {
    pid: child.pid!,
    startedAt: new Date().toISOString(),
    reviewIntervalMinutes: reviewInterval,
    autoworkIntervalMinutes: autoworkInterval,
    routines,
    status: 'idle',
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

export interface DrainReviewQueueOptions {
  repoRoot: string;
  state?: DaemonState;
  options?: DaemonOptions;
  isStopping?: () => boolean;
  clearTicker?: () => void;
  getPRs?: (repoRoot: string) => Promise<ReviewablePR[]>;
  runRoutine?: (opts: any) => Promise<{ success: boolean; exitCode?: number }>;
  onAttempted?: (prNumber: number) => void;
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
  } = drainOptions;

  if (isStopping()) return;
  if (state) {
    state.lastReviewCheckAt = new Date().toISOString();
    writeDaemonState(repoRoot, state);
  }

  let reviewablePRs = await getPRs(repoRoot);

  if (reviewablePRs.length === 0) {
    if (options.verbose) {
      console.log(pc.dim(`[${new Date().toLocaleTimeString()}] Peer Review Watchdog: 0 ready PRs found (0 tokens used).`));
    }
    return;
  }

  const attemptedPRNumbers = new Set<number>();

  while (!isStopping() && reviewablePRs.length > 0) {
    const candidatePRs = reviewablePRs.filter((pr) => !attemptedPRNumbers.has(pr.number));
    if (candidatePRs.length === 0) {
      if (options.verbose) {
        console.log(
          pc.dim(
            `[${new Date().toLocaleTimeString()}] All ${reviewablePRs.length} remaining ready PR(s) were already evaluated in this drain pass.`
          )
        );
      }
      break;
    }

    const totalRemaining = candidatePRs.length;
    let targetPRStr: string | undefined = undefined;

    try {
      if (clearTicker) clearTicker();
      if (state) {
        state.status = 'working';
        state.activeRoutine = 'peer-review';
        writeDaemonState(repoRoot, state);
      }

      console.log(
        pc.cyan(
          `\n[${new Date().toLocaleTimeString()}] 🔍 Peer Review Watchdog: Draining PR backlog (${totalRemaining} PR(s) remaining). Starting review session...`
        )
      );
      await cleanupStaleWorktrees(repoRoot);

      const result = await runRoutine({
        targetDir: repoRoot,
        routine: 'peer-review',
        model: options.model,
        verbose: options.verbose,
        noWorktree: false,
        onTargetDetected: (target: string) => {
          targetPRStr = target;
          if (state) {
            state.activeTarget = target;
            writeDaemonState(repoRoot, state);
          }
        },
      });

      // Record attempted PR number from detected target or candidate list
      const activeTargetStr = targetPRStr as string | undefined;
      const match = activeTargetStr?.match(/PR\s*#?([0-9]+)/i);
      const prNum = match ? parseInt(match[1], 10) : candidatePRs[0]?.number;
      if (typeof prNum === 'number') {
        attemptedPRNumbers.add(prNum);
        onAttempted?.(prNum);
      }

      if (result.success) {
        console.log(pc.green(`✓ Local peer-review completed successfully.\n`));
      } else {
        console.warn(pc.yellow(`⚠️  Local peer-review completed with code ${result.exitCode}.\n`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error in peer-review: ${err.message}`));
      if (candidatePRs[0]) {
        attemptedPRNumbers.add(candidatePRs[0].number);
        onAttempted?.(candidatePRs[0].number);
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
    reviewablePRs = await getPRs(repoRoot);
  }
}

/**
 * Runs the multi-cadence polling daemon loop in the current process with interactive controls.
 */
export async function runDaemonLoop(repoRoot: string, options: DaemonOptions = {}): Promise<void> {
  const reviewInterval = options.reviewInterval || 3;
  const autoworkInterval = options.autoworkInterval || options.interval || 30;
  const routines = options.routines || ['peer-review', 'autowork'];

  const state: DaemonState = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    reviewIntervalMinutes: reviewInterval,
    autoworkIntervalMinutes: autoworkInterval,
    routines,
    status: 'idle',
  };
  writeDaemonState(repoRoot, state);

  console.log(pc.cyan(`\n🤖 Jonah Fleet Multi-Cadence Local Agent Daemon Started`));
  console.log(pc.dim(`   PID: ${process.pid}`));
  console.log(pc.dim(`   Peer Review Watchdog: Every ${reviewInterval} minutes (with zero-cost PR preflight)`));
  console.log(pc.dim(`   Autowork Backlog Scan: Every ${autoworkInterval} minutes`));
  console.log(pc.dim(`   Working Directory: ${repoRoot}`));
  console.log(pc.dim(`   Interactive Hotkeys: 'r' (review), 'a' (autowork), 'p' (pause), 's' (status), 'q' (stop), '?' (help)\n`));

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
      });
      const prs = await getPRsFn(repoRoot);
      lastOpenPRCount = prs.length;
    } finally {
      isWorking = false;
      state.status = isPaused ? 'paused' : 'idle';
      state.activeRoutine = undefined;
      state.activeTarget = undefined;
      writeDaemonState(repoRoot, state);
      nextReviewCheckTime = Date.now() + reviewIntervalMs;
      updateTicker();

      if (isGracefulStopping) {
        await handleStop();
        return;
      }

      if (pendingRoutine && !isStopping) {
        const next = pendingRoutine;
        pendingRoutine = null;
        console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] ⚡ Executing queued routine: ${next}...`));
        if (next === 'peer-review') {
          await performReviewDrain();
        } else if (next === 'autowork') {
          await runAutoworkCheck();
        }
      }
    }
  };

  const runAutoworkCheck = async (): Promise<void> => {
    if (isStopping || isWorking || !routines.includes('autowork')) return;

    try {
      isWorking = true;
      nextAutoworkCheckTime = Date.now() + autoworkIntervalMs;

      // Strict priority invariant: drain reviewable PRs before running autowork
      if (routines.includes('peer-review')) {
        const pendingPRs = (await getPRsFn(repoRoot)).length;
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
            isStopping: () => isStopping,
            clearTicker,
            getPRs: getPRsFn,
            runRoutine: runRoutineFn,
          });
          const prs = await getPRsFn(repoRoot);
          lastOpenPRCount = prs.length;

          const remainingPRs = (await getPRsFn(repoRoot)).length;
          if (remainingPRs > 0) {
            console.log(
              pc.yellow(
                `\n[${new Date().toLocaleTimeString()}] ⚠️  Review backlog still has ${remainingPRs} pending PR(s). Postponing autowork session.`
              )
            );
            return;
          }
        }
      }

      state.lastAutoworkCheckAt = new Date().toISOString();
      clearTicker();
      state.status = 'working';
      state.activeRoutine = 'autowork';
      writeDaemonState(repoRoot, state);

      console.log(pc.cyan(`\n[${new Date().toLocaleTimeString()}] 🚀 Autowork Backlog Scan: Starting session...`));
      await cleanupStaleWorktrees(repoRoot);

      const result = await runRoutineFn({
        targetDir: repoRoot,
        routine: 'autowork',
        model: options.model,
        verbose: options.verbose,
        noWorktree: false,
        onTargetDetected: (target: string) => {
          state.activeTarget = target;
          writeDaemonState(repoRoot, state);
        },
      });

      if (result.success) {
        console.log(pc.green(`✓ Local autowork completed successfully.\n`));
      } else {
        console.warn(pc.yellow(`⚠️  Local autowork completed with code ${result.exitCode}.\n`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error in autowork: ${err.message}`));
    } finally {
      isWorking = false;
      state.status = isPaused ? 'paused' : 'idle';
      state.activeRoutine = undefined;
      state.activeTarget = undefined;
      writeDaemonState(repoRoot, state);
      nextAutoworkCheckTime = Date.now() + autoworkIntervalMs;
      updateTicker();

      // Immediate post-autowork convergence sweep: if autowork opened/readied a PR, drain it immediately!
      if (!isStopping && routines.includes('peer-review')) {
        const newPRCount = (await getPRsFn(repoRoot)).length;
        if (newPRCount > 0) {
          console.log(
            pc.cyan(
              `\n[${new Date().toLocaleTimeString()}] 🔄 Post-autowork convergence: Found ${newPRCount} ready PR(s). Initiating review sweep...`
            )
          );
          await performReviewDrain();
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
        if (next === 'peer-review') {
          await performReviewDrain();
        } else if (next === 'autowork') {
          await runAutoworkCheck();
        }
      }
    }
  };

  const runTargetedReview = async (prNumber: number): Promise<void> => {
    if (isStopping || isWorking) return;
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

      if (result.success) {
        console.log(pc.green(`✓ Targeted peer-review on PR #${prNumber} completed successfully.\n`));
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
        if (next === 'peer-review') {
          await performReviewDrain();
        } else if (next === 'autowork') {
          await runAutoworkCheck();
        }
      }
    }
  };

  const runTargetedAutowork = async (issueNumber: number): Promise<void> => {
    if (isStopping || isWorking) return;
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
        const newPRCount = (await getPRsFn(repoRoot)).length;
        if (newPRCount > 0) {
          console.log(
            pc.cyan(
              `\n[${new Date().toLocaleTimeString()}] 🔄 Post-autowork convergence: Found ${newPRCount} ready PR(s). Initiating review sweep...`
            )
          );
          await performReviewDrain();
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
        if (next === 'peer-review') {
          await performReviewDrain();
        } else if (next === 'autowork') {
          await runAutoworkCheck();
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

  // Run initial checks on start: drain review queue first, then move to autowork
  if (routines.includes('peer-review')) {
    await performReviewDrain();
  }
  if (!isStopping && !isGracefulStopping && routines.includes('autowork')) {
    await runAutoworkCheck();
  }

  if (isStopping) return;

  // Set up 1-second watchdog tick loop for decoupled intervals and ticker
  let isTicking = false;
  const tick = async () => {
    if (isStopping || isGracefulStopping || isWorking || isPrompting || isTicking) return;
    isTicking = true;

    try {
      if (!isPaused) {
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
