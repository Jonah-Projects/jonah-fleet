import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pc from 'picocolors';

const execFileAsync = promisify(execFile);

export interface SummaryCardOptions {
  routine: string;
  output?: string;
  repoRoot?: string;
  issue?: string | number;
  pr?: string | number;
  title?: string;
  durationMs?: number;
}

export interface ErrorCardOptions {
  routine: string;
  exitCode: number;
  repoRoot: string;
  issue?: string | number;
  pr?: string | number;
  durationMs?: number;
  error?: Error;
}

export interface ParsedRunSummary {
  routine?: string;
  target?: string;
  title?: string;
  decision?: string;
  result?: string;
  duration?: string;
  passes?: Array<{ name: string; status: 'pass' | 'fail' | 'info'; detail?: string }>;
  actions?: string[];
  logPath?: string;
}

/**
 * Strips ANSI color codes to accurately measure visual string length.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Truncates an ANSI-formatted string to a maximum visual width without breaking escape sequences.
 */
export function truncateAnsi(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (stripAnsi(text).length <= maxWidth) return text;

  let visibleCount = 0;
  let result = '';
  let inAnsi = false;
  let ansiBuffer = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\x1b') {
      inAnsi = true;
      ansiBuffer = char;
      continue;
    }

    if (inAnsi) {
      ansiBuffer += char;
      if (char === 'm') {
        inAnsi = false;
        result += ansiBuffer;
        ansiBuffer = '';
      }
      continue;
    }

    if (visibleCount < maxWidth) {
      result += char;
      visibleCount++;
    } else {
      break;
    }
  }

  // Ensure any open ANSI style is reset
  result += '\x1b[0m';
  return result;
}

/**
 * Wraps text into multiple lines bounded by maxWidth without cropping.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else {
      const proposed = current + ' ' + word;
      if (stripAnsi(proposed).length <= maxWidth) {
        current = proposed;
      } else {
        lines.push(current);
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Fetches PR or issue title using GitHub CLI with a tight timeout.
 */
export function fetchTargetTitle(repoRoot: string, target: string): string | null {
  try {
    const prMatch = target.match(/PR\s*#?(\d+)/i);
    if (prMatch) {
      const stdout = execFileSync('gh', ['pr', 'view', prMatch[1], '--json', 'title', '-q', '.title'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      });
      return stdout.trim() || null;
    }

    const issueMatch = target.match(/Issue\s*#?(\d+)/i);
    if (issueMatch) {
      const stdout = execFileSync('gh', ['issue', 'view', issueMatch[1], '--json', 'title', '-q', '.title'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
      });
      return stdout.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Asynchronously fetches PR or issue title using GitHub CLI with a tight timeout.
 */
export async function fetchTargetTitleAsync(repoRoot: string, target: string): Promise<string | null> {
  try {
    const prMatch = target.match(/PR\s*#?(\d+)/i);
    if (prMatch) {
      const { stdout } = await execFileAsync('gh', ['pr', 'view', prMatch[1], '--json', 'title', '-q', '.title'], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 3000,
      });
      return stdout.trim() || null;
    }

    const issueMatch = target.match(/Issue\s*#?(\d+)/i);
    if (issueMatch) {
      const { stdout } = await execFileAsync('gh', ['issue', 'view', issueMatch[1], '--json', 'title', '-q', '.title'], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 3000,
      });
      return stdout.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Returns true if a title represents an autonomous routine execution log rather than a target backlog issue.
 */
export function isRoutineRunTitle(title: string): boolean {
  return /^\[(autowork|peer-review|optimizer|issues-housekeeping|design-review)\]\s+run\b/i.test(title.trim());
}

/**
 * Strips temporary worktree roots and converts absolute worktree paths to clean relative paths.
 */
export function sanitizeWorktreePaths(text: string): string {
  // Replace file:///.../.jonah-fleet/worktrees/<session-id>/ with relative path
  let cleaned = text.replace(/file:\/\/\/[^\s"'()]+?\/\.jonah-fleet\/worktrees\/[^/\s"'()]+\//g, '');

  // Replace /path/to/.jonah-fleet/worktrees/<session-id>/ with relative path
  cleaned = cleaned.replace(/(?:^|[\s"'(`[])(?:\/[^\s"'()]+?)?\.jonah-fleet\/worktrees\/[^/\s"'()]+\//g, (match) => {
    const prefix = match.charAt(0);
    return prefix === '/' ? '' : prefix;
  });

  // Clean Markdown links where text and url are file paths: [`src/foo.ts`](file:///...) -> `src/foo.ts`
  cleaned = cleaned.replace(/\[`?([^`\]]+?)`?\]\(file:\/\/\/[^\s)]+\)/g, '`$1`');

  return cleaned;
}

/**
 * Extracts the '# ... Execution Summary' section from routine output text.
 */
export function extractExecutionSummary(output: string): string | null {
  const summaryHeaderRegex = /#{1,3}\s+([A-Za-z0-9\s_-]*?(?:Execution|Review|Autowork)\s+Summary[\s\S]*)/i;
  const match = output.match(summaryHeaderRegex);
  if (!match) return null;

  let summary = match[1].trim();

  // Strip trailing completion messages if any leaked into the summary
  const trailingSeparators = [
    '✓ Local peer-review completed',
    '✓ Local autowork completed',
    '✓ Local agent session',
    'Peer Review Watchdog:',
    'Autowork Backlog Scan:',
  ];

  for (const sep of trailingSeparators) {
    const idx = summary.indexOf(sep);
    if (idx !== -1) {
      summary = summary.slice(0, idx).trim();
    }
  }

  // Strip any trailing watchdog timestamp e.g. [11:33:37 PM] ...
  const timestampMatch = summary.match(/\n\s*\[\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\][\s\S]*/);
  if (timestampMatch && timestampMatch.index !== undefined) {
    summary = summary.slice(0, timestampMatch.index).trim();
  }

  return sanitizeWorktreePaths(summary);
}

/**
 * Finds the latest run log in .jonah-fleet/runs/<routine>-*.md or legacy .github/prompts/logs/<routine>/*.md.
 */
export function findLatestRunLog(repoRoot: string, routine: string): string | null {
  // 1. Check local run cache in .jonah-fleet/runs
  const runsDir = path.join(repoRoot, '.jonah-fleet', 'runs');
  if (fs.existsSync(runsDir)) {
    try {
      const files = fs
        .readdirSync(runsDir)
        .filter((f) => f.startsWith(`${routine}-`) && f.endsWith('.md'));
      if (files.length > 0) {
        files.sort().reverse();
        return path.join(runsDir, files[0]);
      }
    } catch {}
  }

  // 2. Check legacy logs directory if present
  const logsDir = path.join(repoRoot, '.github', 'prompts', 'logs', routine);
  if (fs.existsSync(logsDir)) {
    try {
      const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
      if (files.length > 0) {
        files.sort().reverse();
        return path.join(logsDir, files[0]);
      }
    } catch {}
  }

  return null;
}

/**
 * Parses markdown run log files into structured data.
 */
export function parseRunLog(logContent: string): ParsedRunSummary {
  const summary: ParsedRunSummary = {
    passes: [],
    actions: [],
  };

  const lines = logContent.split('\n');
  let inMetadata = false;
  let inDoD = false;
  let inFindings = false;
  let inActions = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## Metadata')) {
      inMetadata = true;
      inDoD = false;
      inFindings = false;
      inActions = false;
      continue;
    } else if (trimmed.startsWith('## Definition of Done')) {
      inMetadata = false;
      inDoD = true;
      inFindings = false;
      inActions = false;
      continue;
    } else if (trimmed.startsWith('## Code Review Findings') || trimmed.startsWith('## Findings')) {
      inMetadata = false;
      inDoD = false;
      inFindings = true;
      inActions = false;
      continue;
    } else if (
      trimmed.startsWith('## Execution Trace') ||
      trimmed.startsWith('### Actions Taken') ||
      trimmed.startsWith('## Actions Taken') ||
      trimmed.startsWith('## Artifacts')
    ) {
      inMetadata = false;
      inDoD = false;
      inFindings = false;
      inActions = trimmed.startsWith('### Actions Taken') || trimmed.startsWith('## Actions Taken');
      continue;
    } else if (trimmed.startsWith('## ')) {
      inMetadata = false;
      inDoD = false;
      inFindings = false;
      inActions = false;
    }

    // Strictly parse metadata inside ## Metadata section
    if (inMetadata && trimmed.startsWith('|') && trimmed.includes('|')) {
      const parts = trimmed
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const key = parts[0].toLowerCase();
        const value = parts[1].replace(/[`*]/g, '').trim();
        if (key === 'routine') summary.routine = value;
        if (key === 'target pr' || key === 'target issue' || key === 'target') {
          summary.target = value;
        }
        if (key === 'decision') summary.decision = value;
        if (key === 'result') summary.result = value;
        if (key === 'duration') summary.duration = value;
        if (key === 'title' || key === 'pr title' || key === 'issue title') summary.title = value;
      }
    }

    // Parse Definition of Done
    if (inDoD && trimmed.startsWith('|') && !trimmed.includes('Criterion') && !trimmed.includes('---')) {
      const parts = trimmed
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const criterion = parts[0];
        const metRaw = parts[1].toUpperCase();
        const met = metRaw === 'YES' || metRaw === 'PASS';
        const evidence = parts[2] ? parts[2].trim() : '';

        // Filter out conditional "If in Scan mode and no eligible PRs exist" or N/A criteria
        const isConditionalScan = criterion.toLowerCase().startsWith('if in scan mode and no eligible');
        const isNA = evidence.toLowerCase().includes('n/a') || metRaw === 'N/A';

        if (!isConditionalScan && !isNA) {
          summary.passes?.push({
            name: criterion,
            status: met ? 'pass' : 'fail',
            detail: evidence ? ` (${evidence})` : '',
          });
        }
      }
    }

    if (inActions && (trimmed.startsWith('- ') || trimmed.startsWith('* '))) {
      summary.actions?.push(sanitizeWorktreePaths(trimmed.slice(2)));
    }
  }

  return summary;
}

/**
 * Heuristics to detect active stage from streaming agent tokens.
 */
export function detectActivePhase(chunk: string, currentPhase: string = 'Executing routine'): string {
  const lower = chunk.toLowerCase();

  if (lower.includes('🔒 addressing review findings') || lower.includes('addressing review findings by')) {
    return 'Claimed bounced PR, addressing review findings';
  }
  if (lower.includes('🔒 claimed') || lower.includes('claimed by local autowork') || lower.includes('claimed by autowork')) {
    return 'Claimed target issue, starting implementation';
  }
  if (lower.includes('addressing review findings') || lower.includes('fixing review findings')) {
    return 'Claimed bounced PR, addressing review findings';
  }
  if (lower.includes('starting review (round')) {
    return 'Claimed review window, starting review passes';
  }
  if (lower.includes('check-client-boundary')) return 'Verifying React Server Component boundaries';
  if (lower.includes('type-check') || lower.includes('tsc --noemit')) return 'Running TypeScript type checks';
  if (lower.includes('lint') || lower.includes('eslint')) return 'Running codebase linter';
  if (lower.includes('test') || lower.includes('vitest') || lower.includes('jest')) return 'Running automated test suite';
  if (lower.includes('build') || lower.includes('next build') || lower.includes('tsup')) return 'Running production build verification';
  if (lower.includes('code-review') || lower.includes('subagent')) return 'Running multi-angle code review passes';
  if (lower.includes('squash-merge') || lower.includes('pr merge')) return 'Squash-merging target PR to main';
  if (lower.includes('gh issue create') || lower.includes('autonomous issue synthesis')) return 'Synthesizing tracking issue';
  if (lower.includes('--undo') || lower.includes('draft')) return 'Bouncing PR back to draft for author fixes';
  if (lower.includes('issue edit') || lower.includes('pr edit')) return 'Linking PR & tracking issues';
  if (lower.includes('pr comment') || lower.includes('review summary')) return 'Submitting review comment';
  if (lower.includes('worktree')) return 'Preparing workspace worktree';

  return currentPhase;
}

/**
 * Detects if the agent has selected or claimed a specific issue in Scan mode.
 * Excludes the routine's own tracking issue number if provided.
 */
export function detectClaimedIssue(chunk: string, excludeIssueNumber?: number): string | null {
  const isExcluded = (numStr: string): boolean => {
    if (!excludeIssueNumber) return false;
    return parseInt(numStr, 10) === excludeIssueNumber;
  };

  // Pattern 1: 🔒 Claimed ... #123
  const claimMatches = chunk.matchAll(/🔒\s*Claimed[^\n#]*?#(\d+)/gi);
  for (const m of claimMatches) {
    if (!isExcluded(m[1])) return `Issue #${m[1]}`;
  }

  // Pattern 2: gh issue (view|edit|comment|develop) 123
  const ghMatches = chunk.matchAll(/gh\s+issue\s+(?:view|edit|comment|develop)\s+(\d+)/gi);
  for (const m of ghMatches) {
    if (!isExcluded(m[1])) return `Issue #${m[1]}`;
  }

  // Pattern 3: Candidate issue #123, Selected issue #123, Claiming issue #123
  const textMatches = chunk.matchAll(/(?:selected|claimed|claiming|target(?:ing)?|working|candidate)\s+(?:candidate\s+)?issue\s+#?(\d+)/gi);
  for (const m of textMatches) {
    if (!isExcluded(m[1])) return `Issue #${m[1]}`;
  }

  // Pattern 4: Issue #123 claimed
  const passiveMatches = chunk.matchAll(/issue\s+#(\d+)\s+(?:claimed|selected)/gi);
  for (const m of passiveMatches) {
    if (!isExcluded(m[1])) return `Issue #${m[1]}`;
  }

  return null;
}

/**
 * Detects if the agent has selected a specific pull request in Scan mode.
 */
export function detectClaimedPR(chunk: string): string | null {
  // Pattern 0: 🔒 Addressing review findings ... PR #123 or on #123
  const findingMatch = chunk.match(/(?:addressing\s+review\s+findings|fixing\s+review\s+findings)[^\n#]*?#(\d+)/i);
  if (findingMatch) return `PR #${findingMatch[1]}`;

  // Pattern 1: Starting review (round N) on [PR ]#123 (avoiding run log issue # references)
  const reviewMatch =
    chunk.match(/Starting\s+review[^\n]*?(?:on\s+|PR\s+)#(\d+)/i) ||
    chunk.match(/Starting\s+review(?![^\n]*?(?:run\s+log|tracking\s+log|log\s+issue))[^\n#]*?#(\d+)/i);
  if (reviewMatch) return `PR #${reviewMatch[1]}`;

  // Pattern 2: Selected Target PR: [PR #123] or PR #123
  const prMatch = chunk.match(/(?:selected|target|reviewing)\s+(?:target\s+)?PR:?\s*\[?PR\s*#?(\d+)/i);
  if (prMatch) return `PR #${prMatch[1]}`;

  // Pattern 3: gh pr (view|diff|checkout|review|edit|ready|comment) 123
  const ghPrMatch = chunk.match(/gh\s+pr\s+(?:view|diff|checkout|review|edit|ready|comment)\s+(\d+)/i);
  if (ghPrMatch) return `PR #${ghPrMatch[1]}`;

  return null;
}

/**
 * Strips conventional commit prefixes and trailing issue references,
 * truncating title to fit cleanly within the terminal spinner budget.
 */
export function cleanTargetTitle(title?: string | null, maxLength: number = 28): string {
  if (!title) return '';
  let cleaned = title.trim();

  // Strip conventional commit prefix: e.g. "feat(runner): ", "fix: ", "chore(deps)!: "
  cleaned = cleaned.replace(/^(?:feat|fix|chore|docs|refactor|test|perf|style|ci|build)(?:\([^)]+\))?!?!?:\s*/i, '');

  // Strip trailing issue references: e.g. " (#96)" or " (#96) (#98)"
  cleaned = cleaned.replace(/(?:\s*\(\s*#\d+\s*\))+$/, '');

  cleaned = cleaned.trim();
  if (!cleaned) return '';

  if (cleaned.length > maxLength) {
    const slice = cleaned.slice(0, maxLength);
    const lastSpace = slice.lastIndexOf(' ');
    // If there's a space reasonably close to the boundary (within 8 chars), break on word boundary
    if (lastSpace > maxLength - 8) {
      return slice.slice(0, lastSpace).trimEnd() + '...';
    }
    return slice.trimEnd() + '...';
  }
  return cleaned;
}

/**
 * Formats a target label (e.g. "PR #98" or "Issue #96") with an optional title snippet.
 * Output: "PR #98 (stream real-time...)" or fallback to baseLabel if no title available.
 */
export function formatTargetLabel(baseLabel: string, title?: string | null, maxLength: number = 28): string {
  if (!title) return baseLabel;
  // If baseLabel already has parenthesized snippet, strip it first
  const cleanBase = baseLabel.replace(/\s*\([^)]*\)$/, '').trim();
  const cleanedTitle = cleanTargetTitle(title, maxLength);
  if (!cleanedTitle) return cleanBase;
  return `${cleanBase} (${cleanedTitle})`;
}

/**
 * Maps granular agent tool invocations to clean, human-friendly action descriptions for terminal display.
 */
export function formatActionDescription(toolName: string, params?: Record<string, any>): string {
  const name = toolName || 'unknown';

  if (name === 'run_command') {
    const rawCmd = (params?.CommandLine || params?.command || params?.cmd || '').trim();
    if (!rawCmd) return 'Running command';

    // Test runners & checks
    if (/\b(?:vitest|jest)\b/i.test(rawCmd)) return 'Running vitest';
    if (/\bnpm\s+test\b|\bcargo\s+test\b|\bpytest\b/i.test(rawCmd)) return 'Running test suite';
    if (/type-check|\btsc\b/i.test(rawCmd)) return 'Running TypeScript type checks';
    if (/\blint\b|\beslint\b/i.test(rawCmd)) return 'Running codebase linter';
    if (/\bbuild\b|\btsup\b|\bnext\s+build\b/i.test(rawCmd)) return 'Running production build';

    // GitHub CLI PR operations
    if (/gh\s+pr\s+list/i.test(rawCmd)) return 'Listing open PRs (gh pr list)';
    const prMergeMatch = rawCmd.match(/gh\s+pr\s+merge(?:\s+(\d+))?/i);
    if (prMergeMatch) {
      return prMergeMatch[1] ? `Squash-merging PR #${prMergeMatch[1]}` : 'Squash-merging pull request';
    }
    const prViewMatch = rawCmd.match(/gh\s+pr\s+view(?:\s+(\d+))?/i);
    if (prViewMatch) {
      return prViewMatch[1] ? `Viewing PR #${prViewMatch[1]}` : 'Viewing pull request';
    }
    const prEditMatch = rawCmd.match(/gh\s+pr\s+edit(?:\s+(\d+))?/i);
    if (prEditMatch) {
      return prEditMatch[1] ? `Updating PR #${prEditMatch[1]}` : 'Updating pull request';
    }
    const prReadyMatch = rawCmd.match(/gh\s+pr\s+ready(?:\s+(\d+))?/i);
    if (prReadyMatch) {
      return prReadyMatch[1] ? `Marking PR #${prReadyMatch[1]} ready for review` : 'Marking PR ready for review';
    }
    if (/gh\s+pr\s+create/i.test(rawCmd)) return 'Creating pull request';

    // GitHub CLI issue operations
    if (/gh\s+issue\s+list/i.test(rawCmd)) return 'Listing open issues (gh issue list)';
    const issueViewMatch = rawCmd.match(/gh\s+issue\s+view(?:\s+(\d+))?/i);
    if (issueViewMatch) {
      return issueViewMatch[1] ? `Viewing issue #${issueViewMatch[1]}` : 'Viewing issue';
    }
    const issueEditMatch = rawCmd.match(/gh\s+issue\s+edit(?:\s+(\d+))?/i);
    if (issueEditMatch) {
      return issueEditMatch[1] ? `Updating issue #${issueEditMatch[1]}` : 'Updating issue';
    }
    const issueCommentMatch = rawCmd.match(/gh\s+issue\s+comment(?:\s+(\d+))?/i);
    if (issueCommentMatch) {
      return issueCommentMatch[1] ? `Commenting on issue #${issueCommentMatch[1]}` : 'Commenting on issue';
    }

    // Git commands
    if (/git\s+checkout/i.test(rawCmd)) return 'Git: Checking out branch';
    if (/git\s+status/i.test(rawCmd)) return 'Git: Checking status';
    if (/git\s+diff/i.test(rawCmd)) return 'Git: Inspecting diff';
    if (/git\s+commit/i.test(rawCmd)) return 'Git: Committing changes';
    if (/git\s+push/i.test(rawCmd)) return 'Git: Pushing branch';

    // Generic command fallback: clean up first line
    const firstLine = rawCmd.split('\n')[0].trim();
    return `Running ${firstLine}`;
  }

  if (name === 'view_file') {
    const rawPath = params?.AbsolutePath || params?.TargetFile || params?.path || params?.file || '';
    if (!rawPath) return 'Reading file';
    return `Reading ${path.basename(rawPath)}`;
  }

  if (name === 'replace_file_content' || name === 'write_to_file' || name === 'multi_replace_file_content') {
    const rawPath = params?.TargetFile || params?.AbsolutePath || params?.path || params?.file || '';
    if (!rawPath) return 'Editing file';
    return `Editing ${path.basename(rawPath)}`;
  }

  if (name === 'grep_search') {
    const query = params?.Query || params?.query || params?.pattern || '';
    if (!query) return 'Searching codebase';
    return `Searching codebase for "${query}"`;
  }

  if (name === 'find_by_name') {
    const pattern = params?.Pattern || params?.pattern || '';
    if (!pattern) return 'Finding files';
    return `Finding files matching "${pattern}"`;
  }

  if (name === 'list_dir') {
    const dirPath = params?.DirectoryPath || params?.path || '';
    if (!dirPath) return 'Listing directory';
    const base = path.basename(dirPath.replace(/[/\\]+$/, '')) || dirPath;
    return `Listing directory ${base}`;
  }

  if (name === 'invoke_subagent') {
    const role =
      params?.Subagents?.[0]?.Role ||
      params?.Subagents?.[0]?.role ||
      params?.Role ||
      params?.role ||
      params?.TypeName ||
      params?.name ||
      '';
    if (!role) return 'Running subagent';
    return `Running subagent: ${role}`;
  }

  if (name === 'search_web') {
    const query = params?.query || params?.Query || '';
    if (!query) return 'Searching web';
    return `Searching web for "${query}"`;
  }

  if (name === 'read_url_content') {
    const url = params?.Url || params?.url || '';
    if (!url) return 'Reading URL content';
    return `Reading URL ${url}`;
  }

  return `Tool: ${name}`;
}

/**
 * Renders a styled Unicode summary card.
 */
export function renderSummaryCard(options: SummaryCardOptions): string {
  const width = Math.min(Math.max((process.stdout.columns || 80) - 4, 64), 90);
  const horizontal = '─'.repeat(width - 2);

  const rawSummary = options.output ? extractExecutionSummary(options.output) : null;
  let parsedFromLog: ParsedRunSummary | null = null;

  if (options.repoRoot) {
    const latestLog = findLatestRunLog(options.repoRoot, options.routine);
    if (latestLog) {
      try {
        const content = fs.readFileSync(latestLog, 'utf8');
        parsedFromLog = parseRunLog(content);
        parsedFromLog.logPath = path.relative(options.repoRoot, latestLog);
      } catch {
        // Ignore read errors
      }
    }
  }

  // Format header target
  let target = options.pr ? `PR #${options.pr}` : options.issue ? `Issue #${options.issue}` : '';
  if (!target && parsedFromLog?.target && parsedFromLog.target.toUpperCase() !== 'YES') {
    const rawTarget = parsedFromLog.target;
    target = rawTarget.startsWith('#')
      ? (options.routine === 'peer-review' ? `PR ${rawTarget}` : `Issue ${rawTarget}`)
      : rawTarget;
  }
  if (!target && options.output) {
    const targetMatch =
      options.output.match(/Selected\s+Target\s+PR:?\s*\[?PR\s*#?(\d+)\]?/i) ||
      options.output.match(/Starting\s+review[^\n#]*?#(\d+)/i) ||
      options.output.match(/Target(?:ing)?\s+(?:issue|PR)\s*#?(\d+)/i) ||
      options.output.match(/Candidate\s+issue\s*#?(\d+)/i);
    if (targetMatch) {
      target = options.routine === 'peer-review' ? `PR #${targetMatch[1]}` : `Issue #${targetMatch[1]}`;
    }
  }

  // Format PR / Issue Title
  let title = options.title || parsedFromLog?.title || '';
  if (!title && rawSummary) {
    const titleMatch =
      rawSummary.match(/\[PR\s*#?\d+\s*\((`?[^`)]+`?)\)\]/i) ||
      rawSummary.match(/Selected\s+Target\s+PR:?\s*\[.*?\]\([^)]+\)\s*\(([^)]+)\)/i) ||
      rawSummary.match(/PR\s*#?\d+[:\s]+`?([^`\n]+)`?/i);
    if (titleMatch) title = titleMatch[1].replace(/[`*]/g, '').trim();
  }
  if (!title && options.output) {
    const titleMatch =
      options.output.match(/Selected\s+Target\s+PR:?\s*\[PR\s*#?\d+\s*\((`?[^`)]+`?)\)\]/i) ||
      options.output.match(/Selected\s+candidate\s+issue\s*#?\d+[:\s]+`?([^`\n]+)`?/i);
    if (titleMatch) title = titleMatch[1].replace(/[`*]/g, '').trim();
  }
  if (!title && options.repoRoot && target) {
    title = fetchTargetTitle(options.repoRoot, target) || '';
  }

  // Decision
  let decision = parsedFromLog?.decision || '';
  if (!decision && rawSummary) {
    const decisionMatch = rawSummary.match(/\*\*Final Action\*\*:\s*([^\n]+)/i);
    if (decisionMatch) decision = decisionMatch[1].replace(/[`*]/g, '').trim();
  }

  const durationStr = options.durationMs
    ? `${Math.round(options.durationMs / 1000)}s`
    : parsedFromLog?.duration || '';

  const border = (s: string) => pc.dim(pc.gray(s));
  const lines: string[] = [];
  lines.push(border(`┌${horizontal}┐`));

  // Title Bar line
  const headerParts = [pc.bold(pc.white(options.routine.toUpperCase()))];
  if (target) headerParts.push(pc.yellow(target));
  if (durationStr) headerParts.push(pc.dim(`(${durationStr})`));
  const headerContent = headerParts.join(' · ');
  const headerPlain = stripAnsi(headerContent);

  lines.push(
    border('│') +
      ` ${headerContent}` +
      ' '.repeat(Math.max(1, width - 3 - headerPlain.length)) +
      border('│')
  );

  // PR / Issue Title line (with multi-line wrapping so nothing is cropped!)
  if (title) {
    const titlePrefix = ' Title: ';
    const wrappedTitle = wrapText(title, width - 4 - titlePrefix.length);
    for (let i = 0; i < wrappedTitle.length; i++) {
      const prefix = i === 0 ? pc.dim(titlePrefix) : ' '.repeat(titlePrefix.length);
      const text = wrappedTitle[i];
      const plainLen = titlePrefix.length + stripAnsi(text).length;
      lines.push(
        border('│') +
          ` ${prefix}${pc.white(pc.bold(text))}` +
          ' '.repeat(Math.max(1, width - 3 - plainLen)) +
          border('│')
      );
    }
  }

  // Action / Decision line
  if (decision) {
    let decisionBadge = pc.green(`✔ ${decision}`);
    if (/bounce|draft|reject|fail/i.test(decision)) {
      decisionBadge = pc.yellow(`⚠️  ${decision}`);
    } else if (/escalat/i.test(decision)) {
      decisionBadge = pc.red(`🚨 ${decision}`);
    }
    const decisionPlain = ` Action: ${decision}`;
    lines.push(
      border('│') +
        ` Action: ${decisionBadge}` +
        ' '.repeat(Math.max(1, width - 3 - decisionPlain.length)) +
        border('│')
    );
  }

  lines.push(border(`├${horizontal}┤`));

  // Format body content (Summary or Fallback Passes)
  if (rawSummary) {
    const summaryLines = rawSummary.split('\n');

    for (const rawLine of summaryLines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('# ')) continue;
      if (line.startsWith('---')) continue;
      if (line.startsWith('**Selected Target') || line.startsWith('**Final Action') || line.startsWith('**Mode**:')) {
        continue; // Handled in card header
      }

      if (line.startsWith('### ')) {
        const heading = line.replace('### ', '').trim();
        lines.push(
          border('│') +
            ` ${pc.bold(pc.cyan(heading))}` +
            ' '.repeat(Math.max(1, width - 3 - heading.length)) +
            border('│')
        );
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        const item = sanitizeWorktreePaths(line.slice(2)).trim();
        const formatted = item
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/\*\*([^*]+)\*\*/g, (_, text) => pc.bold(text))
          .replace(/`([^`]+)`/g, (_, code) => pc.yellow(code));

        const wrapped = wrapText(formatted, width - 8);
        for (let i = 0; i < wrapped.length; i++) {
          const wLine = wrapped[i];
          const wPlain = stripAnsi(wLine);
          if (i === 0) {
            lines.push(
              border('│') +
                `  • ${wLine}` +
                ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
                border('│')
            );
          } else {
            lines.push(
              border('│') +
                `    ${wLine}` +
                ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
                border('│')
            );
          }
        }
      } else if (/^[0-9]+\.\s+/.test(line)) {
        const item = sanitizeWorktreePaths(line.replace(/^[0-9]+\.\s+/, '')).trim();
        const formatted = item
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/\*\*([^*]+)\*\*/g, (_, text) => pc.bold(text))
          .replace(/`([^`]+)`/g, (_, code) => pc.yellow(code));

        const wrapped = wrapText(formatted, width - 8);
        for (let i = 0; i < wrapped.length; i++) {
          const wLine = wrapped[i];
          const wPlain = stripAnsi(wLine);
          if (i === 0) {
            lines.push(
              border('│') +
                `  ✔ ${wLine}` +
                ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
                border('│')
            );
          } else {
            lines.push(
              border('│') +
                `    ${wLine}` +
                ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
                border('│')
            );
          }
        }
      }
    }
  } else if (parsedFromLog && parsedFromLog.passes && parsedFromLog.passes.length > 0) {
    lines.push(border('│') + ` ${pc.bold('Verification Passes:')}` + ' '.repeat(Math.max(1, width - 23)) + border('│'));
    for (const pass of parsedFromLog.passes.slice(0, 6)) {
      const icon = pass.status === 'pass' ? pc.green('✔') : pc.red('✖');
      let criterionName = pass.name;
      const colonIdx = criterionName.indexOf(':');
      if (colonIdx > 10 && colonIdx < 40) {
        criterionName = criterionName.slice(0, colonIdx);
      }
      const passText = `${criterionName}${pass.detail || ''}`;
      const wrapped = wrapText(passText, width - 8);
      for (let i = 0; i < wrapped.length; i++) {
        const wLine = wrapped[i];
        const wPlain = stripAnsi(wLine);
        if (i === 0) {
          lines.push(
            border('│') +
              `  ${icon} ${wLine}` +
              ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
              border('│')
          );
        } else {
          lines.push(
            border('│') +
              `    ${pc.dim(wLine)}` +
              ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
              border('│')
          );
        }
      }
    }

    if (parsedFromLog.actions && parsedFromLog.actions.length > 0) {
      lines.push(border('│') + ` ${pc.bold('Actions Taken:')}` + ' '.repeat(Math.max(1, width - 16)) + border('│'));
      for (const action of parsedFromLog.actions.slice(0, 4)) {
        const wrapped = wrapText(action, width - 8);
        for (let i = 0; i < wrapped.length; i++) {
          const wLine = wrapped[i];
          const wPlain = stripAnsi(wLine);
          if (i === 0) {
            lines.push(
              border('│') +
                `  • ${wLine}` +
                ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
                border('│')
            );
          } else {
            lines.push(
              border('│') +
                `    ${wLine}` +
                ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
                border('│')
            );
          }
        }
      }
    }
  }

  // Footer section with log link
  if (parsedFromLog?.logPath) {
    lines.push(border(`├${horizontal}┤`));
    const logInfo = ` Run log: ${pc.dim(parsedFromLog.logPath)}`;
    const logPlain = ` Run log: ${parsedFromLog.logPath}`;
    lines.push(border('│') + logInfo + ' '.repeat(Math.max(1, width - 2 - logPlain.length)) + border('│'));
  }

  lines.push(border(`└${horizontal}┘`));
  return lines.join('\n');
}

/**
 * Renders an Error Card with tail of daemon.log.
 */
export function renderErrorCard(options: ErrorCardOptions): string {
  const width = Math.min(Math.max((process.stdout.columns || 80) - 4, 60), 86);
  const horizontal = '─'.repeat(width - 2);

  const lines: string[] = [];
  lines.push(pc.red(`┌${horizontal}┐`));

  const target = options.pr ? ` · PR #${options.pr}` : options.issue ? ` · Issue #${options.issue}` : '';
  const durationStr = options.durationMs ? ` (${Math.round(options.durationMs / 1000)}s)` : '';
  const routineUpper = options.routine.toUpperCase();
  const header = ` ✗ Routine '${routineUpper}' Failed (Exit Code ${options.exitCode})${target}${durationStr}`;
  const headerPlain = ` ✗ Routine '${routineUpper}' Failed (Exit Code ${options.exitCode})${target}${durationStr}`;

  lines.push(
    pc.red('│') +
      pc.bold(pc.red(header.slice(0, width - 3))) +
      ' '.repeat(Math.max(1, width - 2 - headerPlain.length)) +
      pc.red('│')
  );
  lines.push(pc.red(`├${horizontal}┤`));

  // Extract log tail
  const logPath = path.join(options.repoRoot, '.jonah-fleet', 'daemon.log');
  lines.push(pc.red('│') + pc.yellow(' Recent Log Output:') + ' '.repeat(Math.max(1, width - 21)) + pc.red('│'));

  if (fs.existsSync(logPath)) {
    try {
      const logContent = fs.readFileSync(logPath, 'utf8');
      const allLines = logContent.split('\n').filter((l) => l.trim().length > 0);
      const tailLines = allLines.slice(-10);

      for (const line of tailLines) {
        const cleaned = sanitizeWorktreePaths(line).trim();
        const truncated = cleaned.length > width - 6 ? cleaned.slice(0, width - 9) + '...' : cleaned;
        lines.push(pc.red('│') + pc.dim(`  ${truncated}`) + ' '.repeat(Math.max(1, width - 4 - truncated.length)) + pc.red('│'));
      }
    } catch {
      lines.push(
        pc.red('│') + pc.dim('  (Could not read .jonah-fleet/daemon.log)') + ' '.repeat(Math.max(1, width - 45)) + pc.red('│')
      );
    }
  } else {
    lines.push(pc.red('│') + pc.dim('  (No daemon.log found)') + ' '.repeat(Math.max(1, width - 26)) + pc.red('│'));
  }

  lines.push(pc.red(`├${horizontal}┤`));
  const relLogPath = path.relative(options.repoRoot, logPath) || '.jonah-fleet/daemon.log';
  const footer = ` Full trace: ${relLogPath}`;
  const truncatedFooter = footer.slice(0, width - 4);
  lines.push(pc.red('│') + pc.dim(truncatedFooter) + ' '.repeat(Math.max(1, width - 2 - truncatedFooter.length)) + pc.red('│'));
  lines.push(pc.red(`└${horizontal}┘`));

  return lines.join('\n');
}

/**
 * Minimalist zero-dependency terminal spinner.
 */
export class TerminalSpinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private message: string = '';
  private isRunning: boolean = false;
  private isTTY: boolean;

  constructor() {
    this.isTTY = Boolean(process.stderr.isTTY);
  }

  public start(initialMessage: string): void {
    this.message = initialMessage;
    this.startTime = Date.now();
    this.isRunning = true;

    if (!this.isTTY) {
      process.stderr.write(`[jonah-fleet] ${initialMessage}\n`);
      return;
    }

    this.intervalId = setInterval(() => {
      this.render();
    }, 80);
  }

  public update(newMessage: string): void {
    this.message = newMessage;
    if (!this.isTTY) {
      process.stderr.write(`[jonah-fleet] ${newMessage}\n`);
    }
  }

  public formatLine(message: string, maxWidth?: number): string {
    const cols = maxWidth ?? (process.stderr.columns || process.stdout.columns || 80);
    const frame = pc.cyan(this.frames[this.currentFrame]);
    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    const timePlain = `[${mins}m ${secs < 10 ? '0' : ''}${secs}s]`;
    const timeStr = pc.dim(timePlain);

    // Fixed parts = 2 (prefix spaces) + 1 (frame) + 1 (space) + 2 (spaces before time) + timePlain.length
    const fixedWidth = 6 + timePlain.length;
    const availableMsgWidth = Math.max(0, cols - fixedWidth - 1);

    let truncatedMsg = message;
    if (stripAnsi(message).length > availableMsgWidth) {
      truncatedMsg =
        availableMsgWidth > 3
          ? truncateAnsi(message, availableMsgWidth - 3) + '...'
          : truncateAnsi(message, availableMsgWidth);
    }

    return `  ${frame} ${truncatedMsg}  ${timeStr}`;
  }

  private render(): void {
    if (!this.isRunning || !this.isTTY) return;

    this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    const line = this.formatLine(this.message);

    // \r moves to beginning of line, \x1b[K clears line to right
    process.stderr.write(`\r\x1b[K${line}`);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.isTTY) {
      process.stderr.write('\r\x1b[K');
    }
  }
}

export interface BacklogIssueInfo {
  number: number;
  title: string;
  labels?: Array<{ name: string }>;
  assignees?: Array<{ login: string }>;
  url?: string;
}

export interface BacklogTriageReport {
  actionable: BacklogIssueInfo[];
  inProgress: BacklogIssueInfo[];
  gatedHuman: BacklogIssueInfo[];
  awaitingInfo: BacklogIssueInfo[];
  guardrails: BacklogIssueInfo[];
  routineLogs: BacklogIssueInfo[];
  total: number;
}

export interface BacklogCardOptions {
  width?: number;
  repoRoot?: string;
}

/**
 * Renders a formatted diagnostic card when Autowork backlog preflight finds 0 actionable issues.
 */
export function renderBacklogDiagnosticCard(
  report: BacklogTriageReport,
  options?: BacklogCardOptions
): string {
  const width = options?.width || Math.min(Math.max((process.stdout.columns || 80) - 4, 64), 90);
  const horizontal = '─'.repeat(width - 2);
  const border = (s: string) => pc.dim(pc.gray(s));

  const lines: string[] = [];
  lines.push(border(`┌${horizontal}┐`));

  const total =
    report.total ??
    ((report.actionable?.length || 0) +
      (report.inProgress?.length || 0) +
      (report.gatedHuman?.length || 0) +
      (report.awaitingInfo?.length || 0) +
      (report.guardrails?.length || 0) +
      (report.routineLogs?.length || 0));

  const actionableCount = report.actionable?.length || 0;

  // Header Title Bar
  const headerParts = [
    pc.bold(pc.white('AUTOWORK BACKLOG TRIAGE')),
    pc.yellow(`${actionableCount} Actionable`),
    pc.dim('(0 tokens used)'),
  ];
  const headerContent = headerParts.join(' · ');
  const headerPlain = stripAnsi(headerContent);

  lines.push(
    border('│') +
      ` ${headerContent}` +
      ' '.repeat(Math.max(1, width - 3 - headerPlain.length)) +
      border('│')
  );

  // If backlog is completely empty
  const hasNoGated =
    (report.inProgress?.length || 0) === 0 &&
    (report.gatedHuman?.length || 0) === 0 &&
    (report.awaitingInfo?.length || 0) === 0 &&
    (report.guardrails?.length || 0) === 0;

  if (total === 0 || (hasNoGated && actionableCount === 0)) {
    lines.push(border(`├${horizontal}┤`));
    const emptyMsg = 'Backlog is completely empty. 0 open issues found.';
    lines.push(
      border('│') +
        `  ${pc.bold(emptyMsg)}` +
        ' '.repeat(Math.max(1, width - 4 - stripAnsi(emptyMsg).length)) +
        border('│')
    );
    const tipMsg = 'Tip: Create an issue with priority/P1 or priority/P2 to trigger Autowork.';
    lines.push(
      border('│') +
        `  ${pc.dim(tipMsg)}` +
        ' '.repeat(Math.max(1, width - 4 - stripAnsi(tipMsg).length)) +
        border('│')
    );
    lines.push(border(`└${horizontal}┘`));
    return lines.join('\n');
  }

  // Preflight status line
  const statusMsg = `Preflight: Zero-token bypass active (no worktrees spawned)`;
  lines.push(
    border('│') +
      `  ${pc.dim(statusMsg)}` +
      ' '.repeat(Math.max(1, width - 4 - stripAnsi(statusMsg).length)) +
      border('│')
  );

  lines.push(border(`├${horizontal}┤`));

  const renderSection = (
    title: string,
    colorFn: (s: string) => string,
    items: BacklogIssueInfo[],
    reasonLabel: string
  ) => {
    if (!items || items.length === 0) return;
    const sectionHeader = ` ${colorFn(pc.bold(title))}`;
    lines.push(
      border('│') +
        sectionHeader +
        ' '.repeat(Math.max(1, width - 2 - stripAnsi(sectionHeader).length)) +
        border('│')
    );

    for (const item of items) {
      const itemTitle = cleanTargetTitle(item.title, width - 36);
      const text = `• #${item.number}: ${itemTitle} (${reasonLabel})`;
      const wrapped = wrapText(text, width - 8);
      for (let i = 0; i < wrapped.length; i++) {
        const wLine = wrapped[i];
        const wPlain = stripAnsi(wLine);
        lines.push(
          border('│') +
            `   ${wLine}` +
            ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
            border('│')
        );
      }
    }
  };

  if (report.gatedHuman && report.gatedHuman.length > 0) {
    renderSection('Gated by Human Decision (needs-human):', pc.red, report.gatedHuman, 'Gated: needs-human');
  }

  if (report.awaitingInfo && report.awaitingInfo.length > 0) {
    renderSection(
      'Awaiting Specifications (needs-info / needs-design):',
      pc.yellow,
      report.awaitingInfo,
      'Awaiting info: needs-info'
    );
  }

  if (report.inProgress && report.inProgress.length > 0) {
    renderSection('Already In Progress:', pc.blue, report.inProgress, 'In Progress');
  }

  if (report.guardrails && report.guardrails.length > 0) {
    renderSection('Metrics & Guardrails (measurement / wontfix):', pc.magenta, report.guardrails, 'Guardrail: measurement');
  }

  if (report.routineLogs && report.routineLogs.length > 0) {
    const routineText = ` Operational Logs: ${report.routineLogs.length} routine run log(s) filtered`;
    lines.push(
      border('│') +
        pc.dim(routineText) +
        ' '.repeat(Math.max(1, width - 2 - stripAnsi(routineText).length)) +
        border('│')
    );
  }

  // Hints to unblock section
  lines.push(border(`├${horizontal}┤`));
  const hintsHeader = ` ${pc.bold('Hints to unblock:')}`;
  lines.push(
    border('│') +
      hintsHeader +
      ' '.repeat(Math.max(1, width - 2 - stripAnsi(hintsHeader).length)) +
      border('│')
  );

  const hints: string[] = [];
  if (report.awaitingInfo && report.awaitingInfo.length > 0) {
    hints.push("Remove 'needs-info' or 'needs-design' once specifications are clarified.");
  }
  if (report.gatedHuman && report.gatedHuman.length > 0) {
    hints.push("Remove 'needs-human' if autonomous implementation is appropriate.");
  }
  if (report.inProgress && report.inProgress.length > 0) {
    hints.push("Merge or close open PRs, or unassign human assignees to allow agent pickup.");
  }
  if (hints.length === 0) {
    hints.push("Add priority/P1 or priority/P2 label to an issue to schedule autonomous work.");
  }

  for (const hint of hints) {
    const text = `• ${hint}`;
    const wrapped = wrapText(text, width - 8);
    for (const wLine of wrapped) {
      const wPlain = stripAnsi(wLine);
      lines.push(
        border('│') +
          `   ${pc.dim(wLine)}` +
          ' '.repeat(Math.max(1, width - 5 - wPlain.length)) +
          border('│')
      );
    }
  }

  lines.push(border(`└${horizontal}┘`));
  return lines.join('\n');
}
