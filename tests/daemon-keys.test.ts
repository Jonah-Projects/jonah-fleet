import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  KeyboardController,
  printKeybindingCheatSheet,
  printDaemonStatusSummary,
} from '../src/lib/daemon-keys.js';
import {
  DaemonState,
  writeDaemonState,
  readDaemonState,
  getDaemonStatePath,
  runDaemonLoop,
} from '../src/lib/daemon.js';

class MockStdin extends EventEmitter {
  public isTTY = true;
  public rawMode = false;
  public resumed = false;
  public paused = false;

  setRawMode(mode: boolean) {
    this.rawMode = mode;
    return this;
  }

  resume() {
    this.resumed = true;
    this.paused = false;
    return this;
  }

  pause() {
    this.paused = true;
    this.resumed = false;
    return this;
  }
}

describe('KeyboardController', () => {
  let mockStdin: MockStdin;

  beforeEach(() => {
    mockStdin = new MockStdin();
  });

  it('enables raw mode and attaches keypress listener on start when isTTY is true', () => {
    const controller = new KeyboardController({ stdin: mockStdin as any });
    controller.start();

    expect(mockStdin.rawMode).toBe(true);
    expect(mockStdin.resumed).toBe(true);
    expect(mockStdin.listenerCount('keypress')).toBe(1);

    controller.stop();
    expect(mockStdin.rawMode).toBe(false);
    expect(mockStdin.paused).toBe(true);
    expect(mockStdin.listenerCount('keypress')).toBe(0);
  });

  it('resumes stdin stream when resume() is called', () => {
    const controller = new KeyboardController({ stdin: mockStdin as any });
    controller.start();
    mockStdin.pause();
    expect(mockStdin.paused).toBe(true);

    controller.resume();
    expect(mockStdin.resumed).toBe(true);
    expect(mockStdin.paused).toBe(false);

    controller.stop();
  });

  it('gracefully skips raw mode when isTTY is false', () => {
    mockStdin.isTTY = false;
    const controller = new KeyboardController({ stdin: mockStdin as any });
    controller.start();

    expect(mockStdin.rawMode).toBe(false);
    expect(mockStdin.listenerCount('keypress')).toBe(1);

    controller.stop();
  });

  it('gracefully handles stdin streams without setRawMode', () => {
    const plainEmitter = new EventEmitter();
    const controller = new KeyboardController({ stdin: plainEmitter as any });
    expect(() => controller.start()).not.toThrow();
    expect(plainEmitter.listenerCount('keypress')).toBe(1);
    expect(() => controller.stop()).not.toThrow();
  });

  it('routes "r" hotkey to onReview callback and "R" to onTargetedReview callback', () => {
    const onReview = vi.fn();
    const onTargetedReview = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onReview, onTargetedReview });
    controller.start();

    // Lowercase 'r'
    mockStdin.emit('keypress', 'r', { name: 'r', ctrl: false, meta: false, shift: false });
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onTargetedReview).not.toHaveBeenCalled();

    // Uppercase 'R' with shift
    mockStdin.emit('keypress', 'R', { name: 'r', ctrl: false, meta: false, shift: true });
    expect(onTargetedReview).toHaveBeenCalledTimes(1);

    // Uppercase 'R' raw string
    mockStdin.emit('keypress', 'R', undefined);
    expect(onTargetedReview).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('routes "a" hotkey to onAutowork callback and "A" to onTargetedAutowork callback', () => {
    const onAutowork = vi.fn();
    const onTargetedAutowork = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onAutowork, onTargetedAutowork });
    controller.start();

    // Lowercase 'a'
    mockStdin.emit('keypress', 'a', { name: 'a', ctrl: false, meta: false, shift: false });
    expect(onAutowork).toHaveBeenCalledTimes(1);
    expect(onTargetedAutowork).not.toHaveBeenCalled();

    // Uppercase 'A' with shift
    mockStdin.emit('keypress', 'A', { name: 'a', ctrl: false, meta: false, shift: true });
    expect(onTargetedAutowork).toHaveBeenCalledTimes(1);

    // Uppercase 'A' raw string
    mockStdin.emit('keypress', 'A', undefined);
    expect(onTargetedAutowork).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('routes "v" hotkey to onToggleVerbose callback', () => {
    const onToggleVerbose = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onToggleVerbose });
    controller.start();

    mockStdin.emit('keypress', 'v', { name: 'v', ctrl: false, meta: false, shift: false });
    expect(onToggleVerbose).toHaveBeenCalledTimes(1);

    mockStdin.emit('keypress', 'V', { name: 'v', ctrl: false, meta: false, shift: true });
    expect(onToggleVerbose).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('routes "l" hotkey to onTailLog callback', () => {
    const onTailLog = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onTailLog });
    controller.start();

    mockStdin.emit('keypress', 'l', { name: 'l', ctrl: false, meta: false, shift: false });
    expect(onTailLog).toHaveBeenCalledTimes(1);

    mockStdin.emit('keypress', 'L', { name: 'l', ctrl: false, meta: false, shift: true });
    expect(onTailLog).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('routes "w" hotkey to onCleanWorktrees callback', () => {
    const onCleanWorktrees = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onCleanWorktrees });
    controller.start();

    mockStdin.emit('keypress', 'w', { name: 'w', ctrl: false, meta: false, shift: false });
    expect(onCleanWorktrees).toHaveBeenCalledTimes(1);

    mockStdin.emit('keypress', 'W', { name: 'w', ctrl: false, meta: false, shift: true });
    expect(onCleanWorktrees).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('routes "p" hotkey to onPauseToggle callback', () => {
    const onPauseToggle = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onPauseToggle });
    controller.start();

    mockStdin.emit('keypress', 'p', { name: 'p', ctrl: false, meta: false, shift: false });
    expect(onPauseToggle).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it('routes "s" hotkey to onStatus callback', () => {
    const onStatus = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onStatus });
    controller.start();

    mockStdin.emit('keypress', 's', { name: 's', ctrl: false, meta: false, shift: false });
    expect(onStatus).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it('routes "q" hotkey to onGracefulStop callback', () => {
    const onGracefulStop = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onGracefulStop });
    controller.start();

    mockStdin.emit('keypress', 'q', { name: 'q', ctrl: false, meta: false, shift: false });
    expect(onGracefulStop).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it('routes "?" and "h" hotkeys to onHelp callback', () => {
    const onHelp = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onHelp });
    controller.start();

    mockStdin.emit('keypress', '?', { name: undefined, sequence: '?' });
    expect(onHelp).toHaveBeenCalledTimes(1);

    mockStdin.emit('keypress', 'h', { name: 'h', ctrl: false, meta: false, shift: false });
    expect(onHelp).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('routes Ctrl+C to onForceStop callback', () => {
    const onForceStop = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onForceStop });
    controller.start();

    mockStdin.emit('keypress', '\u0003', { name: 'c', ctrl: true, meta: false, shift: false });
    expect(onForceStop).toHaveBeenCalledTimes(1);

    // Also handles raw \u0003 string
    mockStdin.emit('keypress', '\u0003', undefined);
    expect(onForceStop).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it('supports pause and resume to temporarily suspend hotkey handling', () => {
    const onReview = vi.fn();
    const controller = new KeyboardController({ stdin: mockStdin as any, onReview });
    controller.start();

    controller.pause();
    mockStdin.emit('keypress', 'r', { name: 'r' });
    expect(onReview).not.toHaveBeenCalled();

    controller.resume();
    mockStdin.emit('keypress', 'r', { name: 'r' });
    expect(onReview).toHaveBeenCalledTimes(1);

    controller.stop();
  });

  it('ignores unrelated keypresses safely', () => {
    const callbacks = {
      onReview: vi.fn(),
      onTargetedReview: vi.fn(),
      onAutowork: vi.fn(),
      onTargetedAutowork: vi.fn(),
      onPauseToggle: vi.fn(),
      onStatus: vi.fn(),
      onToggleVerbose: vi.fn(),
      onTailLog: vi.fn(),
      onCleanWorktrees: vi.fn(),
      onGracefulStop: vi.fn(),
      onForceStop: vi.fn(),
      onHelp: vi.fn(),
    };
    const controller = new KeyboardController({ stdin: mockStdin as any, ...callbacks });
    controller.start();

    mockStdin.emit('keypress', 'x', { name: 'x', ctrl: false, meta: false, shift: false });
    mockStdin.emit('keypress', 'z', { name: 'z', ctrl: false, meta: false, shift: false });

    Object.values(callbacks).forEach((cb) => {
      expect(cb).not.toHaveBeenCalled();
    });

    controller.stop();
  });
});

describe('Daemon Status and Keybinding UI formatting', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-daemon-keys-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('prints keybinding cheat-sheet without throwing', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printKeybindingCheatSheet()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('prints daemon status summary with pending queue information', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const state: DaemonState = {
      pid: 12345,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['peer-review', 'autowork'],
      status: 'paused',
    };
    writeDaemonState(tmpRepo, state);

    expect(() =>
      printDaemonStatusSummary({
        repoRoot: tmpRepo,
        state,
        pendingRoutine: 'autowork',
        activeWorktrees: [{ branch: 'feat/test', path: '/tmp/wt-1' }],
      })
    ).not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('Daemon State Transitions & Queuing', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-state-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('persists and restores "paused" status in daemon.json', () => {
    const state: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['peer-review', 'autowork'],
      status: 'paused',
    };

    writeDaemonState(tmpRepo, state);
    const read = readDaemonState(tmpRepo);
    expect(read?.status).toBe('paused');
  });
});

describe('Daemon Loop Interactive Integration', () => {
  let tmpRepo: string;
  let mockStdin: MockStdin;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-daemon-loop-test-'));
    mockStdin = new MockStdin();
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('handles pause and resume hotkey transitions in daemon state file', async () => {
    let daemonState: DaemonState = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      reviewIntervalMinutes: 3,
      autoworkIntervalMinutes: 30,
      routines: ['peer-review', 'autowork'],
      status: 'idle',
    };
    writeDaemonState(tmpRepo, daemonState);

    let isPaused = false;
    const controller = new KeyboardController({
      stdin: mockStdin as any,
      onPauseToggle: () => {
        isPaused = !isPaused;
        daemonState.status = isPaused ? 'paused' : 'idle';
        writeDaemonState(tmpRepo, daemonState);
      },
    });
    controller.start();

    // Toggle pause
    mockStdin.emit('keypress', 'p', { name: 'p' });
    expect(readDaemonState(tmpRepo)?.status).toBe('paused');

    // Toggle resume
    mockStdin.emit('keypress', 'p', { name: 'p' });
    expect(readDaemonState(tmpRepo)?.status).toBe('idle');

    controller.stop();
  });

  it('queues routine when busy and dispatches upon completion', async () => {
    let isWorking = true;
    let pendingRoutine: 'peer-review' | 'autowork' | null = null;
    const executedRoutines: string[] = [];

    const controller = new KeyboardController({
      stdin: mockStdin as any,
      onReview: () => {
        if (isWorking) {
          pendingRoutine = 'peer-review';
          return;
        }
        executedRoutines.push('peer-review');
      },
      onAutowork: () => {
        if (isWorking) {
          pendingRoutine = 'autowork';
          return;
        }
        executedRoutines.push('autowork');
      },
    });
    controller.start();

    // Press 'r' while busy -> queues 'peer-review'
    mockStdin.emit('keypress', 'r', { name: 'r' });
    expect(pendingRoutine).toBe('peer-review');
    expect(executedRoutines).toEqual([]);

    // Press 'a' while busy -> updates queue to 'autowork'
    mockStdin.emit('keypress', 'a', { name: 'a' });
    expect(pendingRoutine).toBe('autowork');

    // Simulate current job completing and dispatcher picking up queue
    isWorking = false;
    if (pendingRoutine) {
      const next = pendingRoutine;
      pendingRoutine = null;
      if (next === 'autowork') executedRoutines.push('autowork');
    }

    expect(executedRoutines).toEqual(['autowork']);
    expect(pendingRoutine).toBeNull();

    controller.stop();
  });

  it('supports graceful stop request while busy', async () => {
    let isWorking = true;
    let isGracefulStopping = false;
    let exitCleanedUp = false;

    const controller = new KeyboardController({
      stdin: mockStdin as any,
      onGracefulStop: () => {
        if (isWorking) {
          isGracefulStopping = true;
          return;
        }
        exitCleanedUp = true;
      },
    });
    controller.start();

    // Press 'q' while working -> sets graceful stopping
    mockStdin.emit('keypress', 'q', { name: 'q' });
    expect(isGracefulStopping).toBe(true);
    expect(exitCleanedUp).toBe(false);

    // When job completes, checks isGracefulStopping
    isWorking = false;
    if (isGracefulStopping) {
      exitCleanedUp = true;
    }

    expect(exitCleanedUp).toBe(true);
    controller.stop();
  });

  it('handles targeted review and autowork dispatching when idle vs busy', async () => {
    let isWorking = false;
    const targetedReviewCalls: number[] = [];
    const targetedAutoworkCalls: number[] = [];
    const warnings: string[] = [];

    const controller = new KeyboardController({
      stdin: mockStdin as any,
      onTargetedReview: () => {
        if (isWorking) {
          warnings.push('Targeted review requires idle state');
          return;
        }
        targetedReviewCalls.push(91);
      },
      onTargetedAutowork: () => {
        if (isWorking) {
          warnings.push('Targeted autowork requires idle state');
          return;
        }
        targetedAutoworkCalls.push(89);
      },
    });
    controller.start();

    // Idle: triggers targeted review
    mockStdin.emit('keypress', 'R', { name: 'r', shift: true });
    expect(targetedReviewCalls).toEqual([91]);

    // Idle: triggers targeted autowork
    mockStdin.emit('keypress', 'A', { name: 'a', shift: true });
    expect(targetedAutoworkCalls).toEqual([89]);

    // Busy: warns and does not dispatch
    isWorking = true;
    mockStdin.emit('keypress', 'R', { name: 'r', shift: true });
    mockStdin.emit('keypress', 'A', { name: 'a', shift: true });
    expect(warnings).toEqual([
      'Targeted review requires idle state',
      'Targeted autowork requires idle state',
    ]);
    expect(targetedReviewCalls).toEqual([91]);
    expect(targetedAutoworkCalls).toEqual([89]);

    controller.stop();
  });
});

describe('parseNumericTarget', () => {
  it('parses valid positive integer targets in various formats', async () => {
    const { parseNumericTarget } = await import('../src/lib/daemon-keys.js');

    expect(parseNumericTarget('42')).toBe(42);
    expect(parseNumericTarget('  105  ')).toBe(105);
    expect(parseNumericTarget('#88')).toBe(88);
    expect(parseNumericTarget('PR #91')).toBe(91);
    expect(parseNumericTarget('pr 91')).toBe(91);
    expect(parseNumericTarget('Issue #89')).toBe(89);
    expect(parseNumericTarget('issue 89')).toBe(89);
    expect(parseNumericTarget('#1')).toBe(1);
  });

  it('returns null for empty, non-numeric, zero, or negative inputs', async () => {
    const { parseNumericTarget } = await import('../src/lib/daemon-keys.js');

    expect(parseNumericTarget('')).toBeNull();
    expect(parseNumericTarget('   ')).toBeNull();
    expect(parseNumericTarget('abc')).toBeNull();
    expect(parseNumericTarget('PR abc')).toBeNull();
    expect(parseNumericTarget('0')).toBeNull();
    expect(parseNumericTarget('#0')).toBeNull();
    expect(parseNumericTarget('-5')).toBeNull();
  });
});

describe('promptTargetedInput', () => {
  it('reads numeric input string and returns trimmed value', async () => {
    const { promptTargetedInput } = await import('../src/lib/daemon-keys.js');
    const stdin = new EventEmitter() as any;
    const stdout = { write: vi.fn() };

    const promptPromise = promptTargetedInput('Enter PR #: ', { stdin, stdout });
    stdin.emit('data', '91\n');

    const result = await promptPromise;
    expect(result).toBe('91');
    expect(stdout.write).toHaveBeenCalledWith('Enter PR #: ');
  });

  it('returns null when user submits empty line or whitespace', async () => {
    const { promptTargetedInput } = await import('../src/lib/daemon-keys.js');
    const stdin = new EventEmitter() as any;
    const stdout = { write: vi.fn() };

    const promptPromise = promptTargetedInput('Enter Issue #: ', { stdin, stdout });
    stdin.emit('data', '   \n');

    const result = await promptPromise;
    expect(result).toBeNull();
  });

  it('returns null when user presses Esc (\\u001b)', async () => {
    const { promptTargetedInput } = await import('../src/lib/daemon-keys.js');
    const stdin = new EventEmitter() as any;
    const stdout = { write: vi.fn() };

    const promptPromise = promptTargetedInput('Enter PR #: ', { stdin, stdout });
    stdin.emit('data', '\u001b');

    const result = await promptPromise;
    expect(result).toBeNull();
  });

  it('resumes stdin and restores raw mode upon completion with MockStdin', async () => {
    const { promptTargetedInput } = await import('../src/lib/daemon-keys.js');
    const stdin = new MockStdin();
    stdin.rawMode = true;
    const stdout = Object.assign(new EventEmitter(), { write: vi.fn() });

    const promptPromise = promptTargetedInput('Enter PR #: ', { stdin: stdin as any, stdout });
    stdin.emit('data', '42\n');

    const result = await promptPromise;
    expect(result).toBe('42');
    expect(stdin.rawMode).toBe(true);
    expect(stdin.resumed).toBe(true);
    expect(stdin.paused).toBe(false);
  });

  it('resumes stdin and restores raw mode upon Esc cancellation with MockStdin', async () => {
    const { promptTargetedInput } = await import('../src/lib/daemon-keys.js');
    const stdin = new MockStdin();
    stdin.rawMode = true;
    const stdout = Object.assign(new EventEmitter(), { write: vi.fn() });

    const promptPromise = promptTargetedInput('Enter PR #: ', { stdin: stdin as any, stdout });
    stdin.emit('data', '\u001b');

    const result = await promptPromise;
    expect(result).toBeNull();
    expect(stdin.rawMode).toBe(true);
    expect(stdin.resumed).toBe(true);
    expect(stdin.paused).toBe(false);
  });
});

describe('Daemon Log Tail and Worktree Inspection', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-tail-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('returns empty array when daemon.log does not exist', async () => {
    const { getDaemonLogTail } = await import('../src/lib/daemon-keys.js');
    expect(getDaemonLogTail(tmpRepo, 20)).toEqual([]);
  });

  it('returns the last N lines of daemon.log correctly', async () => {
    const { getDaemonLogTail, printDaemonLogTail } = await import('../src/lib/daemon-keys.js');
    const logDir = path.join(tmpRepo, '.jonah-fleet');
    fs.mkdirSync(logDir, { recursive: true });
    const logLines = Array.from({ length: 30 }, (_, i) => `Log line ${i + 1}`);
    fs.writeFileSync(path.join(logDir, 'daemon.log'), logLines.join('\n') + '\n', 'utf8');

    const tail = getDaemonLogTail(tmpRepo, 20);
    expect(tail.length).toBe(20);
    expect(tail[0]).toBe('Log line 11');
    expect(tail[19]).toBe('Log line 30');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printDaemonLogTail(tmpRepo, 20)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('inspects worktrees and prints summary card', async () => {
    const { inspectAndCleanWorktrees, printWorktreesInspection } = await import(
      '../src/lib/daemon-keys.js'
    );
    const result = await inspectAndCleanWorktrees(tmpRepo);
    expect(result.active).toEqual([]);
    expect(typeof result.cleaned).toBe('number');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printWorktreesInspection(result)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('Rotating Status-Line Tips & Viewport Width Guardrails', () => {
  it('defines all 11 keybinding tips in DAEMON_STATUS_TIPS and DAEMON_PAUSED_TIPS', async () => {
    const { DAEMON_STATUS_TIPS, DAEMON_PAUSED_TIPS } = await import('../src/lib/daemon-keys.js');

    expect(DAEMON_STATUS_TIPS.length).toBe(11);
    expect(DAEMON_PAUSED_TIPS.length).toBe(11);

    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'r' to run review pass now");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'a' to run autowork scan now");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'R' to review a specific PR #");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'A' to work a specific Issue #");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'p' to pause/resume automatic checks");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 's' to view daemon status");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'v' to toggle verbose streaming");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'l' to view recent log tail");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'w' to inspect/clean worktrees");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press 'q' to stop daemon gracefully");
    expect(DAEMON_STATUS_TIPS).toContain("Tip: press '?' for all keybindings");

    expect(DAEMON_PAUSED_TIPS).toContain("Tip: press 'p' to resume scheduled checks");
  });

  it('calculates rotating tip index every 4 seconds', async () => {
    const { getRotatingTipIndex, getRotatingTip, DAEMON_STATUS_TIPS } = await import(
      '../src/lib/daemon-keys.js'
    );

    expect(getRotatingTipIndex(0, 4, 11)).toBe(0);
    expect(getRotatingTipIndex(1000, 4, 11)).toBe(0);
    expect(getRotatingTipIndex(3999, 4, 11)).toBe(0);
    expect(getRotatingTipIndex(4000, 4, 11)).toBe(1);
    expect(getRotatingTipIndex(7999, 4, 11)).toBe(1);
    expect(getRotatingTipIndex(8000, 4, 11)).toBe(2);
    expect(getRotatingTipIndex(40000, 4, 11)).toBe(10);
    expect(getRotatingTipIndex(44000, 4, 11)).toBe(0); // wrap around

    expect(getRotatingTip(0, DAEMON_STATUS_TIPS)).toBe("Tip: press 'r' to run review pass now");
    expect(getRotatingTip(4000, DAEMON_STATUS_TIPS)).toBe("Tip: press 'a' to run autowork scan now");
    expect(getRotatingTip(8000, DAEMON_STATUS_TIPS)).toBe("Tip: press 'R' to review a specific PR #");
  });

  it('truncates ANSI formatted text without breaking escape sequences via truncateAnsi', async () => {
    const { truncateAnsi } = await import('../src/lib/daemon-keys.js');
    const { stripAnsi } = await import('../src/lib/terminal-card.js');

    expect(truncateAnsi('Hello World', 5)).toBe('Hello\x1b[0m');
    expect(stripAnsi(truncateAnsi('Hello World', 5))).toBe('Hello');

    const colored = '\x1b[31mHello\x1b[39m \x1b[32mWorld\x1b[39m';
    const truncated = truncateAnsi(colored, 7);
    expect(stripAnsi(truncated)).toBe('Hello W');
    expect(stripAnsi(truncated).length).toBe(7);

    expect(truncateAnsi('Short', 10)).toBe('Short');
    expect(truncateAnsi('', 5)).toBe('');
    expect(truncateAnsi('Hello', 0)).toBe('');
  });

  it('formats idle status line with timestamp, countdown, and rotating tip when columns >= 55', async () => {
    const { formatDaemonStatusLine } = await import('../src/lib/daemon-keys.js');
    const { stripAnsi } = await import('../src/lib/terminal-card.js');

    const now = new Date('2026-09-09T12:00:00.000Z');
    const nextCheckTime = now.getTime() + 150000; // 2m 30s

    const line = formatDaemonStatusLine({
      now,
      nextCheckTime,
      columns: 120,
      tipIndex: 0,
      lastOpenPRCount: 2,
    });

    const plain = stripAnsi(line);
    expect(plain).toContain('Watchdog Idle');
    expect(plain).toContain('Next check in 2m 30s (2 ready PRs)');
    expect(plain).toContain("Tip: press 'r' to run review pass now");
    expect(plain.length).toBeLessThanOrEqual(118); // 120 - 2
  });

  it('omits tip and renders only core countdown when terminal columns < 55', async () => {
    const { formatDaemonStatusLine } = await import('../src/lib/daemon-keys.js');
    const { stripAnsi } = await import('../src/lib/terminal-card.js');

    const now = new Date('2026-09-09T12:00:00.000Z');
    const nextCheckTime = now.getTime() + 60000; // 1m 00s

    const line = formatDaemonStatusLine({
      now,
      nextCheckTime,
      columns: 50,
      tipIndex: 0,
    });

    const plain = stripAnsi(line);
    expect(plain).toContain('Watchdog Idle');
    expect(plain).not.toContain('Tip:');
    expect(plain.length).toBeLessThanOrEqual(48); // 50 - 2
  });

  it('formats paused status line with PAUSED indicator and resume tip', async () => {
    const { formatDaemonStatusLine } = await import('../src/lib/daemon-keys.js');
    const { stripAnsi } = await import('../src/lib/terminal-card.js');

    const now = new Date('2026-09-09T12:00:00.000Z');

    const line = formatDaemonStatusLine({
      now,
      isPaused: true,
      columns: 80,
      tipIndex: 0,
    });

    const plain = stripAnsi(line);
    expect(plain).toContain('PAUSED');
    expect(plain).toContain("Tip: press 'p' to resume scheduled checks");
    expect(plain.length).toBeLessThanOrEqual(78);
  });

  it('includes queued routine in status line and respects narrow width boundaries', async () => {
    const { formatDaemonStatusLine } = await import('../src/lib/daemon-keys.js');
    const { stripAnsi } = await import('../src/lib/terminal-card.js');

    const now = new Date('2026-09-09T12:00:00.000Z');
    const nextCheckTime = now.getTime() + 30000;

    const line = formatDaemonStatusLine({
      now,
      nextCheckTime,
      pendingRoutine: 'peer-review',
      columns: 60,
      tipIndex: 1,
    });

    const plain = stripAnsi(line);
    expect(plain.length).toBeLessThanOrEqual(58); // 60 - 2
  });

  it('strictly clamps lines to columns - 2 across varying widths', async () => {
    const { formatDaemonStatusLine } = await import('../src/lib/daemon-keys.js');
    const { stripAnsi } = await import('../src/lib/terminal-card.js');

    const now = new Date('2026-09-09T12:00:00.000Z');
    const nextCheckTime = now.getTime() + 90000;

    for (const cols of [40, 50, 55, 60, 80, 100, 120]) {
      const line = formatDaemonStatusLine({
        now,
        nextCheckTime,
        columns: cols,
        tipIndex: 2,
        lastOpenPRCount: 1,
      });
      const plain = stripAnsi(line);
      expect(plain.length).toBeLessThanOrEqual(cols - 2);
    }
  });

  describe('runDaemonLoop graceful shutdown', () => {
    let tmpRepo: string;

    beforeEach(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-daemon-loop-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('gracefully handles "q" pressed during routine execution without TDZ tickerInterval ReferenceError', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const mockStdin = new MockStdin();

      let routineStarted = false;

      const runRoutine = async () => {
        routineStarted = true;
        // User presses 'q' while routine is working
        mockStdin.emit('keypress', 'q', { name: 'q', ctrl: false, meta: false, shift: false });
        return { success: true };
      };

      await runDaemonLoop(tmpRepo, {
        stdin: mockStdin,
        routines: ['peer-review'],
        getPRs: async () => [{ number: 101, headRefName: 'feat/test', title: 'Test PR' }],
        runRoutine,
      });

      expect(routineStarted).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(readDaemonState(tmpRepo)).toBeNull();
    });

    it('gracefully handles "q" pressed when daemon is idle and ticker is active', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const mockStdin = new MockStdin();

      const loopPromise = runDaemonLoop(tmpRepo, {
        stdin: mockStdin,
        routines: ['peer-review'],
        getPRs: async () => [],
      });

      // Give event loop a cycle so initial check finishes and daemon becomes idle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Press 'q' while idle
      mockStdin.emit('keypress', 'q', { name: 'q', ctrl: false, meta: false, shift: false });

      await loopPromise;

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(readDaemonState(tmpRepo)).toBeNull();
    });

    it('prevents concurrent autowork execution while PR backlog checks are awaiting', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const mockStdin = new MockStdin();

      let activeConcurrentRuns = 0;
      let maxConcurrentRuns = 0;
      let totalRuns = 0;

      const runRoutine = async () => {
        activeConcurrentRuns++;
        maxConcurrentRuns = Math.max(maxConcurrentRuns, activeConcurrentRuns);
        totalRuns++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeConcurrentRuns--;
        return { success: true };
      };

      let prCheckCallCount = 0;
      const getPRs = async () => {
        prCheckCallCount++;
        // Simulate latency during PR list fetch
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [];
      };

      const loopPromise = runDaemonLoop(tmpRepo, {
        stdin: mockStdin,
        routines: ['autowork', 'peer-review'],
        getPRs,
        runRoutine,
      });

      // While initial autowork check is in-flight, simulate user pressing 'a' multiple times
      await new Promise((resolve) => setTimeout(resolve, 10));
      mockStdin.emit('keypress', 'a', { name: 'a', ctrl: false, meta: false, shift: false });
      mockStdin.emit('keypress', 'a', { name: 'a', ctrl: false, meta: false, shift: false });

      // Wait for routine to finish
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Stop daemon
      mockStdin.emit('keypress', 'q', { name: 'q', ctrl: false, meta: false, shift: false });
      await loopPromise;

      expect(maxConcurrentRuns).toBe(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});

