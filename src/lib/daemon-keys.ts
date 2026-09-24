import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { DaemonState } from './daemon.js';
import { WorktreeInfo, listActiveWorktrees, cleanupStaleWorktrees } from './worktree.js';
import { stripAnsi, truncateAnsi } from './terminal-card.js';

export interface KeyboardControllerOptions {
  stdin?: NodeJS.ReadStream | EventEmitter;
  stdout?: NodeJS.WriteStream;
  onReview?: () => Promise<void> | void;
  onAutowork?: () => Promise<void> | void;
  onTargetedReview?: () => Promise<void> | void;
  onTargetedAutowork?: () => Promise<void> | void;
  onPauseToggle?: () => void;
  onStatus?: () => void;
  onToggleVerbose?: () => void;
  onTailLog?: () => Promise<void> | void;
  onCleanWorktrees?: () => Promise<void> | void;
  onGracefulStop?: () => void;
  onForceStop?: () => void;
  onHelp?: () => void;
}

export class KeyboardController {
  private stdin: any;
  private isRaw: boolean = false;
  private listening: boolean = false;
  private isPaused: boolean = false;
  private keypressListener?: (str: string, key: readline.Key) => void;

  constructor(private options: KeyboardControllerOptions = {}) {
    this.stdin = options.stdin || process.stdin;
  }

  public start(): void {
    if (this.listening) return;

    if (this.stdin && typeof this.stdin.setRawMode === 'function' && this.stdin.isTTY) {
      readline.emitKeypressEvents(this.stdin);
      try {
        this.stdin.setRawMode(true);
        this.isRaw = true;
      } catch {
        this.isRaw = false;
      }
      if (typeof this.stdin.resume === 'function') {
        this.stdin.resume();
      }
    }

    this.keypressListener = (str: string, key: readline.Key) => {
      this.handleKeypress(str, key);
    };

    this.stdin.on('keypress', this.keypressListener);
    this.listening = true;
    this.isPaused = false;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
    if (this.listening && this.stdin && typeof this.stdin.resume === 'function') {
      try {
        this.stdin.resume();
      } catch {}
    }
  }

  public handleKeypress(str: string, key?: readline.Key): void {
    if (this.isPaused) return;

    const k = key || ({} as readline.Key);

    // Force stop on Ctrl+C or \u0003
    if ((k.ctrl && (k.name === 'c' || k.name === 'C')) || str === '\u0003') {
      this.options.onForceStop?.();
      return;
    }

    const isShift = Boolean(k.shift);
    const keyName = (k.name || '').toLowerCase();

    // Targeted review: 'R' (str === 'R' or key.name === 'r' with shift)
    if (str === 'R' || (keyName === 'r' && isShift)) {
      this.options.onTargetedReview?.();
      return;
    }

    // Targeted autowork: 'A' (str === 'A' or key.name === 'a' with shift)
    if (str === 'A' || (keyName === 'a' && isShift)) {
      this.options.onTargetedAutowork?.();
      return;
    }

    // Scan review: 'r' (lowercase)
    if (str === 'r' || (keyName === 'r' && !isShift)) {
      this.options.onReview?.();
      return;
    }

    // Scan autowork: 'a' (lowercase)
    if (str === 'a' || (keyName === 'a' && !isShift)) {
      this.options.onAutowork?.();
      return;
    }

    // Verbose toggle: 'v' / 'V'
    if (str === 'v' || str === 'V' || keyName === 'v') {
      this.options.onToggleVerbose?.();
      return;
    }

    // Tail log: 'l' / 'L'
    if (str === 'l' || str === 'L' || keyName === 'l') {
      this.options.onTailLog?.();
      return;
    }

    // Clean / inspect worktrees: 'w' / 'W'
    if (str === 'w' || str === 'W' || keyName === 'w') {
      this.options.onCleanWorktrees?.();
      return;
    }

    // Pause toggle: 'p' / 'P'
    if (str === 'p' || str === 'P' || keyName === 'p') {
      this.options.onPauseToggle?.();
      return;
    }

    // Status: 's' / 'S'
    if (str === 's' || str === 'S' || keyName === 's') {
      this.options.onStatus?.();
      return;
    }

    // Graceful stop: 'q' / 'Q'
    if (str === 'q' || str === 'Q' || keyName === 'q') {
      this.options.onGracefulStop?.();
      return;
    }

    // Help: '?' or 'h' / 'H'
    if (str === '?' || keyName === 'h' || str === 'h' || str === 'H') {
      this.options.onHelp?.();
      return;
    }
  }

  public stop(): void {
    if (!this.listening) return;
    if (this.keypressListener) {
      this.stdin.removeListener('keypress', this.keypressListener);
    }
    if (this.isRaw && typeof this.stdin.setRawMode === 'function') {
      try {
        this.stdin.setRawMode(false);
      } catch {}
      this.isRaw = false;
    }
    if (typeof this.stdin.pause === 'function') {
      try {
        this.stdin.pause();
      } catch {}
    }
    this.listening = false;
    this.isPaused = false;
  }
}

/**
 * Parses numeric pull request or issue numbers from raw user inputs like "42", "#42", "PR #42", "Issue #89".
 */
export function parseNumericTarget(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(?:(?:PR|Issue|pr|issue)\s*#?)?#?(\d+)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    return num > 0 ? num : null;
  }
  return null;
}

export interface PromptTargetedInputOptions {
  stdin?: any;
  stdout?: any;
}

/**
 * Prompts user interactively for a targeted PR or Issue number, temporarily pausing raw mode.
 * Resolves with the trimmed string, or null if cancelled (Esc, Ctrl+C, empty Enter).
 */
export async function promptTargetedInput(
  promptMessage: string,
  options: PromptTargetedInputOptions = {}
): Promise<string | null> {
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;

  if (stdout && typeof stdout.write === 'function') {
    stdout.write(promptMessage);
  }

  return new Promise<string | null>((resolve) => {
    let cleanedUp = false;
    const wasRaw = Boolean(stdin && stdin.rawMode !== undefined ? stdin.rawMode : stdin?.isRaw);

    if (stdin && typeof stdin.setRawMode === 'function' && stdin.isTTY) {
      try {
        stdin.setRawMode(false);
      } catch {}
    }

    if (stdin && typeof stdin.resume !== 'function') {
      stdin.resume = () => {};
    }
    if (stdin && typeof stdin.pause !== 'function') {
      stdin.pause = () => {};
    }

    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: Boolean(stdin && stdin.isTTY),
    });

    const cleanup = (val: string | null) => {
      if (cleanedUp) return;
      cleanedUp = true;

      try {
        if (stdin && typeof stdin.removeListener === 'function') {
          stdin.removeListener('data', onRawData);
        }
        rl.close();
      } catch {}

      if (wasRaw && stdin && typeof stdin.setRawMode === 'function' && stdin.isTTY) {
        try {
          stdin.setRawMode(true);
        } catch {}
      }

      if (stdin && typeof stdin.resume === 'function') {
        try {
          stdin.resume();
        } catch {}
      }
      resolve(val);
    };

    const onRawData = (chunk: Buffer | string) => {
      const str = chunk.toString();
      if (str === '\u001b' || str === '\u0003') {
        cleanup(null);
      }
    };

    if (stdin && typeof stdin.on === 'function') {
      stdin.on('data', onRawData);
    }

    rl.question('', (answer) => {
      cleanup(answer.trim() || null);
    });

    rl.on('close', () => {
      cleanup(null);
    });
  });
}

/**
 * Reads the last N lines from the local daemon log file.
 */
export function getDaemonLogTail(repoRoot: string, linesCount: number = 20): string[] {
  const logPath = path.join(repoRoot, '.jonah-fleet', 'daemon.log');
  if (!fs.existsSync(logPath)) return [];
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.slice(-linesCount);
  } catch {
    return [];
  }
}

/**
 * Prints the last N lines of .jonah-fleet/daemon.log directly to console.
 */
export function printDaemonLogTail(repoRoot: string, linesCount: number = 20): void {
  const lines = getDaemonLogTail(repoRoot, linesCount);
  const logPath = path.join(repoRoot, '.jonah-fleet', 'daemon.log');
  const relativePath = path.relative(repoRoot, logPath) || logPath;

  console.log(pc.bold(pc.cyan(`\n⚡ Tail of ${relativePath} (last ${linesCount} lines):\n`)));
  if (lines.length === 0) {
    console.log(pc.dim(`  (Log file is empty or does not exist yet at ${relativePath})\n`));
    return;
  }

  for (const line of lines) {
    console.log(pc.dim(line));
  }
  console.log('');
}

export interface WorktreeInspectionResult {
  active: WorktreeInfo[];
  cleaned: number;
}

/**
 * Inspects active worktrees and prunes stale worktree directories.
 */
export async function inspectAndCleanWorktrees(repoRoot: string): Promise<WorktreeInspectionResult> {
  const active = await listActiveWorktrees(repoRoot);
  const cleaned = await cleanupStaleWorktrees(repoRoot);
  return { active, cleaned };
}

/**
 * Prints worktree inspection and maintenance details.
 */
export function printWorktreesInspection(result: WorktreeInspectionResult): void {
  console.log(pc.bold(pc.cyan(`\n⚡ Jonah Fleet Worktree Inspection & Maintenance\n`)));
  console.log(`  Active Worktrees: ${result.active.length}`);
  if (result.active.length === 0) {
    console.log(pc.dim(`  (No active routine worktrees found)`));
  } else {
    for (const wt of result.active) {
      const commitShort = wt.commit ? ` (${wt.commit.slice(0, 7)})` : '';
      console.log(`   - [${pc.bold(wt.branch)}] ${pc.dim(wt.path)}${commitShort}`);
    }
  }
  console.log(`\n  Cleaned Stale Worktrees: ${result.cleaned}`);
  console.log('');
}

export function printKeybindingCheatSheet(): void {
  console.log(pc.bold(pc.cyan(`\n⚡ Jonah Fleet Daemon Keybindings // Command Reference\n`)));
  console.log(`  ${pc.bold(pc.green('r'))}        Trigger peer-review scan immediately`);
  console.log(`  ${pc.bold(pc.green('R'))}        Prompt for PR # and run targeted peer-review`);
  console.log(`  ${pc.bold(pc.green('a'))}        Trigger autowork backlog scan immediately`);
  console.log(`  ${pc.bold(pc.green('A'))}        Prompt for Issue # and run targeted autowork`);
  console.log(`  ${pc.bold(pc.green('p'))}        Pause / resume automated polling intervals`);
  console.log(`  ${pc.bold(pc.green('s'))}        Print current daemon status summary card`);
  console.log(`  ${pc.bold(pc.green('v'))}        Toggle verbose streaming logging live`);
  console.log(`  ${pc.bold(pc.green('l'))}        Tail recent lines from .jonah-fleet/daemon.log`);
  console.log(`  ${pc.bold(pc.green('w'))}        Inspect active worktrees and clean stale ones`);
  console.log(`  ${pc.bold(pc.green('q'))}        Graceful shutdown (waits for active routine to finish)`);
  console.log(`  ${pc.bold(pc.red('Ctrl+C'))}   Immediate force abort`);
  console.log(`  ${pc.bold(pc.green('?'))} / ${pc.bold(pc.green('h'))}   Show this keybindings cheat-sheet\n`);
}

export interface DaemonStatusSummaryOptions {
  repoRoot: string;
  state?: DaemonState | null;
  pendingRoutine?: string | null;
  activeWorktrees?: WorktreeInfo[];
  verbose?: boolean;
}

export function printDaemonStatusSummary(options: DaemonStatusSummaryOptions): void {
  const { state, pendingRoutine, activeWorktrees = [], verbose } = options;

  console.log(pc.bold(pc.cyan(`\n⚡ Jonah Fleet Daemon Status Readout\n`)));
  if (state) {
    let statusText: string;
    if (state.status === 'working') {
      const workingDesc = state.activeRoutine + (state.activeTarget ? ` (${pc.bold(state.activeTarget)})` : '');
      statusText = pc.yellow(pc.bold(`WORKING on ${workingDesc}`));
    } else if (state.status === 'paused') {
      statusText = pc.yellow(pc.bold('PAUSED'));
    } else {
      statusText = pc.green(pc.bold('RUNNING (IDLE)'));
    }

    console.log(`  Status:               ${statusText}`);
    console.log(`  PID:                  ${state.pid}`);
    console.log(`  Started:              ${new Date(state.startedAt).toLocaleString()}`);
    console.log(`  Peer Review Cadence:  Every ${state.reviewIntervalMinutes} minutes (0-token fast preflight)`);
    console.log(`  Autowork Cadence:     Every ${state.autoworkIntervalMinutes} minutes`);
    console.log(`  Routines:             ${state.routines.join(', ')}`);
    if (verbose !== undefined) {
      console.log(
        `  Verbose Mode:         ${verbose ? pc.green('ENABLED (streaming tokens)') : pc.gray('DISABLED (compact spinner)')}`
      );
    }
    if (pendingRoutine) {
      console.log(`  Queued Routine:       ${pc.cyan(pc.bold(pendingRoutine))}`);
    }
    if (state.lastReviewCheckAt) {
      console.log(`  Last Review Check:    ${new Date(state.lastReviewCheckAt).toLocaleTimeString()}`);
    }
    if (state.lastAutoworkCheckAt) {
      console.log(`  Last Autowork Check:  ${new Date(state.lastAutoworkCheckAt).toLocaleTimeString()}`);
    }
  } else {
    console.log(`  Status:               ${pc.gray('STOPPED')}`);
    console.log(pc.dim(`  Run 'jonah-fleet daemon start' to start the local worker daemon.`));
  }

  console.log(`\n  Active Worktrees: ${activeWorktrees.length}`);
  for (const wt of activeWorktrees) {
    console.log(pc.dim(`   - [${wt.branch}] ${wt.path}`));
  }
  console.log('');
}

export const DAEMON_STATUS_TIPS: readonly string[] = [
  "Tip: press 'r' to run review pass now",
  "Tip: press 'a' to run autowork scan now",
  "Tip: press 'R' to review a specific PR #",
  "Tip: press 'A' to work a specific Issue #",
  "Tip: press 'p' to pause/resume automatic checks",
  "Tip: press 's' to view daemon status",
  "Tip: press 'v' to toggle verbose streaming",
  "Tip: press 'l' to view recent log tail",
  "Tip: press 'w' to inspect/clean worktrees",
  "Tip: press 'q' to stop daemon gracefully",
  "Tip: press '?' for all keybindings",
];

export const DAEMON_PAUSED_TIPS: readonly string[] = [
  "Tip: press 'p' to resume scheduled checks",
  "Tip: press 'r' to run review pass now",
  "Tip: press 'a' to run autowork scan now",
  "Tip: press 'R' to review a specific PR #",
  "Tip: press 'A' to work a specific Issue #",
  "Tip: press 's' to view daemon status",
  "Tip: press 'v' to toggle verbose streaming",
  "Tip: press 'l' to view recent log tail",
  "Tip: press 'w' to inspect/clean worktrees",
  "Tip: press 'q' to stop daemon gracefully",
  "Tip: press '?' for all keybindings",
];

export { truncateAnsi };

/**
 * Calculates the current tip index by dividing elapsed or current timestamp by rotation interval.
 */
export function getRotatingTipIndex(
  nowMs: number = Date.now(),
  intervalSeconds: number = 4,
  totalTips: number = DAEMON_STATUS_TIPS.length
): number {
  if (totalTips <= 0) return 0;
  const slot = Math.floor(nowMs / (intervalSeconds * 1000));
  return ((slot % totalTips) + totalTips) % totalTips;
}

/**
 * Retrieves the active rotating tip string for the given timestamp.
 */
export function getRotatingTip(
  nowMs: number = Date.now(),
  tips: readonly string[] = DAEMON_STATUS_TIPS,
  intervalSeconds: number = 4
): string {
  if (!tips || tips.length === 0) return '';
  const idx = getRotatingTipIndex(nowMs, intervalSeconds, tips.length);
  return tips[idx];
}

export interface FormatDaemonStatusLineOptions {
  now?: Date | number;
  isPaused?: boolean;
  nextCheckTime?: number;
  lastOpenPRCount?: number;
  pendingRoutine?: string | null;
  columns?: number;
  tipIndex?: number;
  tips?: readonly string[];
}

/**
 * Formats the single-line daemon idle/paused status ticker with rotating tips and viewport width clamping.
 */
export function formatDaemonStatusLine(options: FormatDaemonStatusLineOptions = {}): string {
  const nowDate =
    options.now instanceof Date
      ? options.now
      : typeof options.now === 'number'
        ? new Date(options.now)
        : new Date();
  const nowMs = nowDate.getTime();
  const timeString = nowDate.toLocaleTimeString();

  const columns = options.columns !== undefined ? options.columns : (process.stderr.columns || 80);
  const maxCols = Math.max(20, (columns || 80) - 2);
  const includeTip = columns >= 55;

  let core: string;
  if (options.isPaused) {
    const queueStr = options.pendingRoutine ? pc.cyan(` [Queued: ${options.pendingRoutine}]`) : '';
    core = `${pc.dim('[' + timeString + ']')} ⏸  ${pc.yellow('PAUSED')}${queueStr}`;
  } else {
    const nextCheck = options.nextCheckTime !== undefined ? options.nextCheckTime : nowMs;
    const diffMs = Math.max(0, nextCheck - nowMs);
    const remainingSecs = Math.ceil(diffMs / 1000);
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    const timeStr = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
    const prStr = options.lastOpenPRCount !== undefined ? ` (${options.lastOpenPRCount} ready PRs)` : '';
    const queueStr = options.pendingRoutine ? pc.cyan(` [Queued: ${options.pendingRoutine}]`) : '';
    core = `${pc.dim('[' + timeString + ']')} ⚡ ${pc.dim('Watchdog Idle · Next check in ' + timeStr + prStr)}${queueStr}`;
  }

  if (!includeTip) {
    return truncateAnsi(core, maxCols);
  }

  const tipsList = options.tips || (options.isPaused ? DAEMON_PAUSED_TIPS : DAEMON_STATUS_TIPS);
  const tipIdx =
    options.tipIndex !== undefined
      ? options.tipIndex
      : getRotatingTipIndex(nowMs, 4, tipsList.length);
  const tipText = tipsList[((tipIdx % tipsList.length) + tipsList.length) % tipsList.length] || '';

  const fullLine = `${core} ${pc.dim('·')} ${pc.dim(tipText)}`;
  return truncateAnsi(fullLine, maxCols);
}

