import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  sanitizeWorktreePaths,
  extractExecutionSummary,
  findLatestRunLog,
  parseRunLog,
  detectActivePhase,
  detectClaimedIssue,
  detectClaimedPR,
  renderSummaryCard,
  renderErrorCard,
  TerminalSpinner,
  formatActionDescription,
  formatEvaluatingDescription,
  formatSubagentsProgress,
  cleanTargetTitle,
  formatTargetLabel,
  fetchTargetTitleAsync,
  isRoutineRunTitle,
  stripAnsi,
  truncateAnsi,
} from '../src/lib/terminal-card.js';

describe('Terminal UI & Card Primitives', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-card-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  describe('sanitizeWorktreePaths', () => {
    it('strips file:/// URLs pointing to temporary worktrees', () => {
      const raw =
        'Conformance to [`AGENTS.md`](file:///home/user/repo/.jonah-fleet/worktrees/agent-peer-review-2026-09-03/AGENTS.md) and [`DESIGN_SYSTEM.md`](file:///home/user/repo/.jonah-fleet/worktrees/agent-peer-review-2026-09-03/DESIGN_SYSTEM.md)';
      const sanitized = sanitizeWorktreePaths(raw);
      expect(sanitized).not.toContain('.jonah-fleet/worktrees');
      expect(sanitized).not.toContain('file:///');
      expect(sanitized).toContain('`AGENTS.md`');
      expect(sanitized).toContain('`DESIGN_SYSTEM.md`');
    });

    it('strips absolute worktree paths leaving clean relative paths', () => {
      const raw =
        'Inspected /home/user/repo/.jonah-fleet/worktrees/agent-peer-review-2026-09-03/src/components/Nudge.tsx and verified boundary';
      const sanitized = sanitizeWorktreePaths(raw);
      expect(sanitized).not.toContain('.jonah-fleet/worktrees');
      expect(sanitized).toContain('src/components/Nudge.tsx');
    });
  });

  describe('extractExecutionSummary', () => {
    it('extracts markdown summary block from agent output', () => {
      const output = `
The build is finishing up. Continuing when done.
The build is completing. Continuing shortly.
# Peer Review Execution Summary

**Mode**: Scan Mode  
**Selected Target PR**: [PR #3783](https://github.com/org/repo/pull/3783)  
**Final Action**: **MERGED** (Squash commit \`1567d6a0\`)

---

### Review & Verification Passes

1. **Standards**: Conformance to AGENTS.md verified.
2. **Spec**: Clean Next.js RSC boundaries.

---

### Actions Taken

- Squash-merged PR #3783.
✓ Local peer-review completed successfully.
`;

      const summary = extractExecutionSummary(output);
      expect(summary).not.toBeNull();
      expect(summary).toContain('Peer Review Execution Summary');
      expect(summary).toContain('**Final Action**: **MERGED**');
      expect(summary).toContain('### Review & Verification Passes');
      expect(summary).not.toContain('The build is finishing up');
      expect(summary).not.toContain('✓ Local peer-review completed');
    });

    it('returns null if no summary header is present', () => {
      const output = 'Just some arbitrary agent response without execution summary.';
      expect(extractExecutionSummary(output)).toBeNull();
    });
  });

  describe('parseRunLog & findLatestRunLog', () => {
    it('parses structured markdown run log into metadata and criteria', () => {
      const sampleLog = `# Run Log

## Metadata

| Field | Value |
|-------|-------|
| Routine | \`peer-review\` |
| Target PR | \`#3783\` |
| Decision | \`MERGED\` |
| Result | \`SUCCESS\` |
| Duration | 114s |

## Definition of Done evaluation

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Standards Pass | YES | Verified AGENTS.md conventions. |
| Test Suite | YES | 171 test files passed. |

## Actions Taken
- Squash-merged PR #3783 to main.
`;

      const parsed = parseRunLog(sampleLog);
      expect(parsed.routine).toBe('peer-review');
      expect(parsed.target).toBe('#3783');
      expect(parsed.decision).toBe('MERGED');
      expect(parsed.result).toBe('SUCCESS');
      expect(parsed.duration).toBe('114s');
      expect(parsed.passes?.length).toBe(2);
      expect(parsed.passes?.[0].status).toBe('pass');
    });

    it('preserves target from metadata and does not overwrite with YES from DoD table', () => {
      const logWithDoD = `# Run Log

## Metadata

| Field | Value |
|-------|-------|
| Routine | \`peer-review\` |
| Target PR | \`#3783\` |
| Decision | \`MERGED\` |

## Definition of Done evaluation

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Identified target PR: named PR or priority scan | YES | Evaluated open PRs and selected #3783 |
| If in Scan mode and no eligible PRs exist, logged SUCCESS with "No PRs to review" | NO | Found eligible PRs |
`;

      const parsed = parseRunLog(logWithDoD);
      expect(parsed.target).toBe('#3783');
      expect(parsed.decision).toBe('MERGED');
      expect(parsed.passes?.some((p) => p.name.includes('If in Scan mode'))).toBe(false);
    });

    it('finds latest log in repo logs directory', () => {
      const logsDir = path.join(tmpRepo, '.github', 'prompts', 'logs', 'peer-review');
      fs.mkdirSync(logsDir, { recursive: true });

      fs.writeFileSync(path.join(logsDir, '2026-08-26T10-00-00Z.md'), '# Log 1\n');
      fs.writeFileSync(path.join(logsDir, '2026-08-26T12-00-00Z.md'), '# Log 2\n');

      const latest = findLatestRunLog(tmpRepo, 'peer-review');
      expect(latest).not.toBeNull();
      expect(latest).toContain('2026-08-26T12-00-00Z.md');
    });
  });

  describe('detectActivePhase', () => {
    it('detects type checks and linters', () => {
      expect(detectActivePhase('Running npm run type-check')).toContain('type checks');
      expect(detectActivePhase('eslint src/')).toContain('linter');
    });

    it('detects tests and builds', () => {
      expect(detectActivePhase('vitest run')).toContain('test suite');
      expect(detectActivePhase('next build')).toContain('build verification');
    });

    it('detects merges and bounces', () => {
      expect(detectActivePhase('gh pr merge 123 --squash')).toContain('Squash-merging');
      expect(detectActivePhase('gh pr ready 123 --undo')).toContain('draft');
    });

    it('falls back to current phase when unknown', () => {
      expect(detectActivePhase('some random comment', 'Custom phase')).toBe('Custom phase');
    });

    it('detects issue claim in phase detection', () => {
      expect(detectActivePhase('🔒 Claimed by local autowork session (host: devbox)')).toContain('Claimed target issue');
    });

    it('detects PR review finding claim in phase detection', () => {
      expect(detectActivePhase('🔒 Addressing review findings by local autowork session (host: devbox)')).toContain('Claimed bounced PR');
      expect(detectActivePhase('🔒 Addressing review findings by autowork run https://github.com/org/repo/actions/runs/123')).toContain('Claimed bounced PR');
    });
  });

  describe('detectClaimedIssue & detectClaimedPR', () => {
    it('detects claimed issue from lock comment', () => {
      expect(detectClaimedIssue('🔒 Claimed by local autowork session (host: mac) on #42 at 2026-09-03')).toBe('Issue #42');
      expect(detectClaimedIssue('🔒 Claimed candidate #88')).toBe('Issue #88');
    });

    it('detects issue from gh issue command', () => {
      expect(detectClaimedIssue('Running gh issue view 105 --json title')).toBe('Issue #105');
      expect(detectClaimedIssue('gh issue edit 42 --add-assignee user')).toBe('Issue #42');
    });

    it('detects issue from natural language claiming text', () => {
      expect(detectClaimedIssue('Selected candidate issue #99 for implementation')).toBe('Issue #99');
      expect(detectClaimedIssue('Claiming issue #15...')).toBe('Issue #15');
      expect(detectClaimedIssue('Issue #77 claimed atomically.')).toBe('Issue #77');
    });

    it('excludes routine run tracking issue number from claimed issue detection', () => {
      expect(detectClaimedIssue('gh issue edit 1060 --body "..."', 1060)).toBeNull();
      expect(detectClaimedIssue('gh issue edit 1060 --body "..." and gh issue view 1053', 1060)).toBe('Issue #1053');
      expect(detectClaimedIssue('🔒 Claimed candidate #1060', 1060)).toBeNull();
      expect(detectClaimedIssue('Selected candidate issue #1060 for implementation', 1060)).toBeNull();
      expect(detectClaimedIssue('Issue #1060 claimed', 1060)).toBeNull();
    });

    it('returns null when no issue is referenced', () => {
      expect(detectClaimedIssue('Checking backlog for unclaimed issues...')).toBeNull();
    });

    it('identifies routine run titles vs regular issue titles', () => {
      expect(isRoutineRunTitle('[autowork] run 2026-09-19T08-48-55-974Z (local)')).toBe(true);
      expect(isRoutineRunTitle('[peer-review] run 2026-09-20T11-38-11-666Z')).toBe(true);
      expect(isRoutineRunTitle('[issues-housekeeping] run 2026-09-20T11-52-47Z')).toBe(true);
      expect(isRoutineRunTitle('feat(cards): time-based filtering in Story Magazine')).toBe(false);
      expect(isRoutineRunTitle('support WAF-protected feeds')).toBe(false);
    });

    it('detects PR from starting review comment or target PR text', () => {
      expect(detectClaimedPR('Starting review (round 1) on #3783')).toBe('PR #3783');
      expect(detectClaimedPR('Starting review (round 1) on #3783 · [Run Log #848](https://github.com/org/repo/issues/848)')).toBe('PR #3783');
      expect(detectClaimedPR('Starting review (round 1) on PR #847 · Run log: #848')).toBe('PR #847');
      expect(detectClaimedPR('gh pr comment 847 --body "Starting review (round 1) · [Run Log #848]"')).toBe('PR #847');
      expect(detectClaimedPR('Selected Target PR: [PR #3783]')).toBe('PR #3783');
      expect(detectClaimedPR('Running gh pr view 3783 --json diff')).toBe('PR #3783');
      expect(detectClaimedPR('gh pr edit 42 --add-assignee user')).toBe('PR #42');
      expect(detectClaimedPR('🔒 Addressing review findings by autowork run on PR #88')).toBe('PR #88');
    });

    it('returns null when no PR is referenced', () => {
      expect(detectClaimedPR('Scanning open pull requests...')).toBeNull();
    });
  });

  describe('cleanTargetTitle & formatTargetLabel', () => {
    it('strips conventional commit prefixes and trailing issue references', () => {
      expect(cleanTargetTitle('feat(runner): stream real-time granular activity (#96)')).toBe(
        'stream real-time granular...'
      );
      expect(cleanTargetTitle('fix: resolve critical race condition (#12) (#14)')).toBe(
        'resolve critical race...'
      );
      expect(cleanTargetTitle('chore(deps)!: bump vitest dependency')).toBe(
        'bump vitest dependency'
      );
      expect(cleanTargetTitle('docs: update README documentation')).toBe(
        'update README documentation'
      );
    });

    it('retains non-conventional title words and trims whitespace', () => {
      expect(cleanTargetTitle('Fix login button alignment')).toBe('Fix login button alignment');
      expect(cleanTargetTitle('  improve mobile performance  ')).toBe('improve mobile performance');
    });

    it('handles empty, null, or undefined titles safely', () => {
      expect(cleanTargetTitle(undefined)).toBe('');
      expect(cleanTargetTitle(null)).toBe('');
      expect(cleanTargetTitle('')).toBe('');
      expect(cleanTargetTitle('   ')).toBe('');
    });

    it('formats target label with clean title snippet in parentheses', () => {
      expect(
        formatTargetLabel('PR #98', 'feat(runner): stream real-time granular activity to foreground daemon spinner (#96)')
      ).toBe('PR #98 (stream real-time granular...)');

      expect(formatTargetLabel('Issue #96', 'fix: resolve race condition in daemon')).toBe(
        'Issue #96 (resolve race condition in...)'
      );
    });

    it('falls back to base label when title is missing or empty', () => {
      expect(formatTargetLabel('PR #98', undefined)).toBe('PR #98');
      expect(formatTargetLabel('PR #98', '')).toBe('PR #98');
      expect(formatTargetLabel('Issue #42', '   ')).toBe('Issue #42');
    });

    it('replaces existing parenthesized snippet cleanly if already present', () => {
      expect(
        formatTargetLabel('PR #98 (old title)', 'feat(runner): new shiny title')
      ).toBe('PR #98 (new shiny title)');
    });

    it('returns null gracefully on non-existent or failed target title query', async () => {
      const title = await fetchTargetTitleAsync('/tmp/non-existent-repo-path', 'PR #999999');
      expect(title).toBeNull();
    });
  });

  describe('renderSummaryCard', () => {
    it('renders a formatted Unicode card with header and actions', () => {
      const card = renderSummaryCard({
        routine: 'peer-review',
        pr: 3783,
        durationMs: 45000,
        output: `
# Peer Review Execution Summary
**Final Action**: **MERGED**

### Review & Verification Passes
- Verified standards and design tokens.
- All 171 test files passed.

### Actions Taken
- Squash-merged to main.
`,
      });

      expect(card).toContain('┌');
      expect(card).toContain('└');
      expect(card).toContain('PEER-REVIEW');
      expect(card).toContain('PR #3783');
      expect(card).toContain('MERGED');
      expect(card).toContain('45s');
    });

    it('renders PR title and wraps long lines without ellipses cropping', () => {
      const card = renderSummaryCard({
        routine: 'peer-review',
        pr: 3783,
        title: 'feat(predictions): show instant group creation nudge on group tab for users without groups',
        durationMs: 503000,
        output: `
# Peer Review Execution Summary
**Selected Target PR**: [PR #3783 (\`feat(predictions): show instant group creation nudge on group tab for users without groups\`)](https://github.com/org/repo/pull/3783)
**Final Action**: **MERGED**

### Review & Verification Passes
- Conformance to AGENTS.md and DESIGN_SYSTEM.md: correct invariant adherence for macro terminology.
- Clean Next.js React Server Component boundaries verified via check-client-boundary script.
- 171 test files passed (1,609 unit tests) with zero errors.
`,
      });

      expect(card).toContain('PR #3783');
      expect(card).toContain('Title:');
      expect(card).toContain('feat(predictions): show instant group creation nudge');
      expect(card).toContain('MERGED');
      expect(card).toContain('503s');
      expect(card).not.toContain('...');
    });
  });

  describe('renderErrorCard', () => {
    it('renders an error card with recent log tail', () => {
      const daemonLogDir = path.join(tmpRepo, '.jonah-fleet');
      fs.mkdirSync(daemonLogDir, { recursive: true });
      fs.writeFileSync(
        path.join(daemonLogDir, 'daemon.log'),
        'Line 1\nLine 2\nError: build failed at src/index.ts:12\n'
      );

      const card = renderErrorCard({
        routine: 'autowork',
        exitCode: 1,
        repoRoot: tmpRepo,
        issue: 42,
        durationMs: 12000,
      });

      expect(card).toContain('┌');
      expect(card).toContain('AUTOWORK');
      expect(card).toContain('Exit Code 1');
      expect(card).toContain('Issue #42');
      expect(card).toContain('Error: build failed');
      expect(card).toContain('daemon.log');
    });
  });

  describe('formatActionDescription', () => {
    it('formats run_command for test runners', () => {
      expect(formatActionDescription('run_command', { CommandLine: 'npx vitest run' })).toBe('Running vitest');
      expect(formatActionDescription('run_command', { CommandLine: 'npm test' })).toBe('Running test suite');
      expect(formatActionDescription('run_command', { CommandLine: 'npm run type-check' })).toBe('Running TypeScript type checks');
      expect(formatActionDescription('run_command', { CommandLine: 'npm run lint' })).toBe('Running codebase linter');
      expect(formatActionDescription('run_command', { CommandLine: 'npm run build' })).toBe('Running production build');
    });

    it('formats run_command for GitHub CLI PR commands', () => {
      expect(formatActionDescription('run_command', { CommandLine: 'gh pr list --state open' })).toBe('Listing open PRs (gh pr list)');
      expect(formatActionDescription('run_command', { CommandLine: 'gh pr view 42 --json title' })).toBe('Viewing PR #42');
      expect(formatActionDescription('run_command', { CommandLine: 'gh pr merge 42 --squash' })).toBe('Squash-merging PR #42');
      expect(formatActionDescription('run_command', { CommandLine: 'gh pr edit 42 --add-assignee user' })).toBe('Updating PR #42');
      expect(formatActionDescription('run_command', { CommandLine: 'gh pr ready 42' })).toBe('Marking PR #42 ready for review');
      expect(formatActionDescription('run_command', { CommandLine: 'gh pr create --draft --title "feat: xyz"' })).toBe('Creating pull request');
    });

    it('formats run_command for GitHub CLI issue commands', () => {
      expect(formatActionDescription('run_command', { CommandLine: 'gh issue list --state open' })).toBe('Listing open issues (gh issue list)');
      expect(formatActionDescription('run_command', { CommandLine: 'gh issue view 96 --json title' })).toBe('Viewing issue #96');
      expect(formatActionDescription('run_command', { CommandLine: 'gh issue edit 96 --add-assignee user' })).toBe('Updating issue #96');
      expect(formatActionDescription('run_command', { CommandLine: 'gh issue comment 96 --body "claim"' })).toBe('Commenting on issue #96');
    });

    it('formats run_command for git operations', () => {
      expect(formatActionDescription('run_command', { CommandLine: 'git checkout -b feat/stream-events' })).toBe('Git: Checking out branch');
      expect(formatActionDescription('run_command', { CommandLine: 'git status' })).toBe('Git: Checking status');
      expect(formatActionDescription('run_command', { CommandLine: 'git diff origin/main' })).toBe('Git: Inspecting diff');
      expect(formatActionDescription('run_command', { CommandLine: 'git commit -m "feat: new feature"' })).toBe('Git: Committing changes');
      expect(formatActionDescription('run_command', { CommandLine: 'git push origin main' })).toBe('Git: Pushing branch');
    });

    it('formats run_command fallback for generic commands', () => {
      expect(formatActionDescription('run_command', { CommandLine: 'cargo check --all-targets' })).toBe('Running cargo check --all-targets');
      expect(formatActionDescription('run_command', {})).toBe('Running command');
      expect(formatActionDescription('run_command', undefined)).toBe('Running command');
    });

    it('formats view_file with basename extraction', () => {
      expect(formatActionDescription('view_file', { AbsolutePath: '/home/user/repo/src/lib/runner.ts' })).toBe('Reading runner.ts');
      expect(formatActionDescription('view_file', { TargetFile: 'templates/prompts/autowork.md' })).toBe('Reading autowork.md');
      expect(formatActionDescription('view_file', {})).toBe('Reading file');
    });

    it('formats replace_file_content and write_to_file with basename extraction', () => {
      expect(formatActionDescription('replace_file_content', { TargetFile: '/home/user/repo/src/lib/terminal-card.ts' })).toBe('Editing terminal-card.ts');
      expect(formatActionDescription('write_to_file', { TargetFile: 'src/index.ts' })).toBe('Editing index.ts');
      expect(formatActionDescription('replace_file_content', {})).toBe('Editing file');
    });

    it('formats grep_search and find_by_name', () => {
      expect(formatActionDescription('grep_search', { Query: 'stream-json' })).toBe('Searching codebase for "stream-json"');
      expect(formatActionDescription('grep_search', {})).toBe('Searching codebase');
      expect(formatActionDescription('find_by_name', { Pattern: '*.ts' })).toBe('Finding files matching "*.ts"');
      expect(formatActionDescription('find_by_name', {})).toBe('Finding files');
    });

    it('formats list_dir and invoke_subagent', () => {
      expect(formatActionDescription('list_dir', { DirectoryPath: '/home/user/repo/src/lib' })).toBe('Listing directory lib');
      expect(formatActionDescription('list_dir', {})).toBe('Listing directory');
      expect(formatActionDescription('invoke_subagent', { Subagents: [{ Role: 'Codebase Researcher' }] })).toBe('Running subagent: Codebase Researcher');
      expect(formatActionDescription('invoke_subagent', { Role: 'Spec Reviewer' })).toBe('Running subagent: Spec Reviewer');
      expect(formatActionDescription('invoke_subagent', {})).toBe('Running subagent');
    });

    it('formats manage_subagents and manage_task', () => {
      expect(formatActionDescription('manage_subagents', { Action: 'list' })).toBe('Checking subagents progress');
      expect(formatActionDescription('manage_subagents', { Action: 'kill' })).toBe('Stopping subagent');
      expect(formatActionDescription('manage_task', { Action: 'list' })).toBe('Checking background tasks');
      expect(formatActionDescription('schedule', {})).toBe('Scheduling background timer');
    });

    it('handles fallback for custom or unknown tools', () => {
      expect(formatActionDescription('ask_question', { prompt: 'Choose option' })).toBe('Tool: ask_question');
      expect(formatActionDescription('custom_tool')).toBe('Tool: custom_tool');
    });
  });

  describe('formatSubagentsProgress', () => {
    it('formats active subagents with state details', () => {
      const output = JSON.stringify([
        {
          role: 'Standards Reviewer',
          state: 'running',
          stateDetail: 'run_command: Git status check',
        },
        {
          role: 'Spec Reviewer',
          state: 'running',
          stateDetail: 'run_command: Git diff',
        },
      ]);
      const progress = formatSubagentsProgress(output);
      expect(progress).toContain('Subagents running');
      expect(progress).toContain('Standards Reviewer');
      expect(progress).toContain('Git status check');
      expect(progress).toContain('Spec Reviewer');
      expect(progress).toContain('Git diff');
    });

    it('formats mixed completed and running subagents', () => {
      const rawText = `You have 2 active subagent(s):
[
  {"role":"Standards Reviewer","state":"idle"},
  {"role":"Spec Reviewer","state":"running","stateDetail":"view_file: AGENTS.md"}
]`;
      const progress = formatSubagentsProgress(rawText);
      expect(progress).toContain('Subagents:');
      expect(progress).toContain('Standards Reviewer (done)');
      expect(progress).toContain('Spec Reviewer (view AGENTS.md)');
    });

    it('reports subagents completed when all subagents finished', () => {
      const output = JSON.stringify([
        { role: 'Standards Reviewer', state: 'idle' },
        { role: 'Spec Reviewer', state: 'idle' },
      ]);
      expect(formatSubagentsProgress(output)).toBe('Subagents completed, synthesizing reviews...');
      expect(formatSubagentsProgress('[]')).toBe('Subagents completed, synthesizing reviews...');
    });

    it('returns null for non-subagent output', () => {
      expect(formatSubagentsProgress('')).toBeNull();
      expect(formatSubagentsProgress('random output')).toBeNull();
    });
  });

  describe('formatEvaluatingDescription', () => {
    it('formats manage_subagents evaluating description with live progress', () => {
      const output = JSON.stringify([
        {
          role: 'Standards Reviewer',
          state: 'running',
          stateDetail: 'run_command: Git diff',
        },
      ]);
      const desc = formatEvaluatingDescription('manage_subagents', { Action: 'list' }, output);
      expect(desc).toContain('Standards Reviewer');
      expect(desc).toContain('Git diff');
    });

    it('formats run_command evaluating description by command type', () => {
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'npx vitest run' })).toBe('Evaluating vitest results...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'npm test' })).toBe('Evaluating test suite results...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'npm run type-check' })).toBe('Evaluating TypeScript type check results...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'npm run lint' })).toBe('Evaluating codebase linter results...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'npm run build' })).toBe('Evaluating production build results...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'gh pr list --state open' })).toBe('Evaluating open pull requests...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'gh pr view 42' })).toBe('Evaluating PR #42...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'gh issue list --state open' })).toBe('Evaluating open issues...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'gh issue view 96' })).toBe('Evaluating issue #96...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'git diff origin/main' })).toBe('Evaluating git diff...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'git status' })).toBe('Evaluating git status...');
      expect(formatEvaluatingDescription('run_command', { CommandLine: 'git log -n 5' })).toBe('Evaluating git log...');
    });

    it('formats file operations with target file basename', () => {
      expect(formatEvaluatingDescription('view_file', { AbsolutePath: '/repo/src/lib/runner.ts' })).toBe('Evaluating runner.ts...');
      expect(formatEvaluatingDescription('replace_file_content', { TargetFile: '/repo/src/index.ts' })).toBe('Verifying edits to index.ts...');
      expect(formatEvaluatingDescription('write_to_file', { TargetFile: '/repo/tests/test.ts' })).toBe('Verifying edits to test.ts...');
      expect(formatEvaluatingDescription('grep_search', { Query: 'activePhase' })).toBe('Evaluating search results for "activePhase"...');
    });

    it('formats invoke_subagent evaluating description', () => {
      expect(
        formatEvaluatingDescription('invoke_subagent', {
          Subagents: [{ Role: 'Standards Reviewer' }, { Role: 'Spec Reviewer' }],
        })
      ).toBe('Subagents running: Standards Reviewer, Spec Reviewer...');
    });
  });

  describe('TerminalSpinner', () => {
    it('starts, updates, and stops safely', () => {
      const spinner = new TerminalSpinner();
      expect(() => {
        spinner.start('Initializing...');
        spinner.update('Running tests...');
        spinner.stop();
      }).not.toThrow();
    });

    it('formats spinner output bounded by terminal columns without overflow', () => {
      const spinner = new TerminalSpinner();
      const longMessage = 'PR #96: Searching codebase for "very long query string that exceeds normal terminal width and should be safely truncated"';
      const formatted = spinner.formatLine(longMessage, 60);
      expect(stripAnsi(formatted).length).toBeLessThanOrEqual(60);
      expect(formatted).toContain('PR #96:');
    });

    it('deduplicates consecutive identical messages in non-TTY mode', () => {
      const writes: string[] = [];
      const origWrite = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        writes.push(String(chunk));
        return true;
      }) as any;
      try {
        const spinner = new TerminalSpinner();
        (spinner as any).isTTY = false;
        spinner.start('Initializing...');
        spinner.update('Same message');
        spinner.update('Same message');
        spinner.update('Same message');
        spinner.update('New message');
        spinner.stop();
        expect(writes.filter((w) => w.includes('Same message')).length).toBe(1);
        expect(writes.filter((w) => w.includes('New message')).length).toBe(1);
      } finally {
        process.stderr.write = origWrite;
      }
    });
  });

  describe('stripAnsi & truncateAnsi', () => {
    it('strips ANSI color codes accurately', () => {
      const formatted = '\x1b[31mError:\x1b[39m \x1b[1mSomething went wrong\x1b[22m';
      expect(stripAnsi(formatted)).toBe('Error: Something went wrong');
    });

    it('truncates ANSI string to maxWidth and resets open styles', () => {
      const formatted = '\x1b[31mError:\x1b[39m \x1b[1mSomething went wrong\x1b[22m';
      const truncated = truncateAnsi(formatted, 10);
      expect(stripAnsi(truncated)).toBe('Error: Som');
      expect(truncated.endsWith('\x1b[0m')).toBe(true);
    });
  });
});

