import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  discoverSkillsPrompt,
  buildRoutinePrompt,
  runLocalRoutine,
  LineBufferedStreamParser,
  parseStreamJsonEvent,
  formatVerboseEvent,
  buildAgyArgs,
  tryCreateLocalRunIssue,
  tryReconcileLocalRunIssue,
  tryReconcileLocalRunIssueAsync,
  tryMarkLocalRunInterruptedAsync,
  tryPostLocalRunMilestone,
  tryPostLocalRunMilestoneAsync,
  formatMilestoneCard,
  formatInterruptionCard,
  extractFreshRunReport,
  resolveExitCode,
  formatFallbackRunReport,
  detectPrematureRoutineExit,
} from '../src/lib/runner.js';

describe('Local Routine Runner', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-runner-test-'));
    fs.mkdirSync(path.join(tmpRepo, '.agents', 'skills', 'tdd'), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, '.agents', 'skills', 'tdd', 'SKILL.md'), '# TDD\n', 'utf8');

    fs.mkdirSync(path.join(tmpRepo, '.github', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, '.github', 'prompts', 'autowork.md'), '# Autowork\n', 'utf8');
    fs.writeFileSync(path.join(tmpRepo, '.github', 'prompts', 'peer-review.md'), '# Peer Review\n', 'utf8');
    fs.writeFileSync(path.join(tmpRepo, '.github', 'prompts', 'optimizer.md'), '# Optimizer\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('discovers skills in .agents/skills directory', () => {
    const skills = discoverSkillsPrompt(tmpRepo);
    expect(skills).toContain('Read and follow .agents/skills/tdd/SKILL.md.');
  });

  it('builds autowork prompt in Targeted mode', () => {
    const prompt = buildRoutinePrompt(tmpRepo, 'autowork', { issue: 42 });
    expect(prompt).toContain('Targeted mode: work issue #42 directly');
    expect(prompt).toContain('Read and follow .agents/skills/tdd/SKILL.md.');
  });

  it('builds autowork prompt in Scan mode', () => {
    const prompt = buildRoutinePrompt(tmpRepo, 'autowork');
    expect(prompt).toContain('Scan mode: check open PRs for review comments to fix');
    expect(prompt).toContain('Read and follow .agents/skills/tdd/SKILL.md.');
  });

  it('builds peer-review prompt in Targeted mode', () => {
    const prompt = buildRoutinePrompt(tmpRepo, 'peer-review', { pr: 105 });
    expect(prompt).toContain('Targeted mode: review PR #105 directly');
  });

  it('builds peer-review prompt in Scan mode', () => {
    const prompt = buildRoutinePrompt(tmpRepo, 'peer-review');
    expect(prompt).toContain('Scan mode: check open PRs and select the highest-priority PR');
  });

  it('builds peer-review prompt with routineIssueNumber', () => {
    const prompt = buildRoutinePrompt(tmpRepo, 'peer-review', { pr: 105, routineIssueNumber: 848 });
    expect(prompt).toContain('Targeted mode: review PR #105 directly.');
    expect(prompt).toContain('Tracking run log issue: #848.');
  });

  it('enforces headless execution guardrail in routine prompts', () => {
    const prompt = buildRoutinePrompt(tmpRepo, 'peer-review', { pr: 105 });
    expect(prompt).toContain('Execution Guardrail: You are executing in a headless autonomous session');
    expect(prompt).toContain('NEVER call schedule or yield your turn with plain text');
  });

  it('builds agy invocation args with stream-json output format', () => {
    const args = buildAgyArgs('Test prompt', 'gemini-3.8-flash-high', '30m');
    expect(args).toContain('--output-format');
    const idx = args.indexOf('--output-format');
    expect(args[idx + 1]).toBe('stream-json');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('runs local routine in dry-run mode without launching processes', async () => {
    const result = await runLocalRoutine({
      targetDir: tmpRepo,
      routine: 'autowork',
      issue: 99,
      dryRun: true,
      noWorktree: true,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('[DRY RUN]');
    expect(result.output).toContain('issue #99');
  });

  it('accepts verbose flag in runLocalRoutine options', async () => {
    const result = await runLocalRoutine({
      targetDir: tmpRepo,
      routine: 'peer-review',
      pr: 10,
      dryRun: true,
      verbose: true,
      noWorktree: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('[DRY RUN]');
  });

  it('accepts title option in runLocalRoutine and formats target label with title', async () => {
    const result = await runLocalRoutine({
      targetDir: tmpRepo,
      routine: 'peer-review',
      pr: 98,
      title: 'feat(runner): stream real-time granular activity (#96)',
      dryRun: true,
      noWorktree: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('[DRY RUN]');
  });

  describe('LineBufferedStreamParser', () => {
    it('buffers chunks across line splits correctly', () => {
      const lines: string[] = [];
      const parser = new LineBufferedStreamParser((line) => lines.push(line));

      parser.feed('{"event":"init"}\n{"event":"step_');
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('{"event":"init"}');

      parser.feed('update","step_update":{"state":"ACTIVE"}}\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toBe('{"event":"step_update","step_update":{"state":"ACTIVE"}}');
    });

    it('flushes trailing line without newline on flush()', () => {
      const lines: string[] = [];
      const parser = new LineBufferedStreamParser((line) => lines.push(line));

      parser.feed('trailing data');
      expect(lines.length).toBe(0);
      parser.flush();
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('trailing data');
    });
  });

  describe('parseStreamJsonEvent', () => {
    it('parses valid step_update tool events', () => {
      const raw = JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 2,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'run_command',
          tool_info: {
            name: 'run_command',
            parameters: { CommandLine: 'npx vitest run' },
          },
        },
      });

      const parsed = parseStreamJsonEvent(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.event).toBe('step_update');
      expect(parsed?.step_update?.tool_name).toBe('run_command');
      expect(parsed?.step_update?.tool_info?.parameters?.CommandLine).toBe('npx vitest run');
    });

    it('parses result events with response text and tokens', () => {
      const raw = JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: '# Execution Summary\nDone.',
          duration_seconds: 12.5,
          usage: { total_tokens: 15400 },
        },
      });

      const parsed = parseStreamJsonEvent(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.event).toBe('result');
      expect(parsed?.result?.response).toContain('# Execution Summary');
      expect(parsed?.result?.usage?.total_tokens).toBe(15400);
    });

    it('returns null on invalid JSON', () => {
      expect(parseStreamJsonEvent('invalid json text')).toBeNull();
      expect(parseStreamJsonEvent('')).toBeNull();
    });
  });

  describe('formatVerboseEvent', () => {
    it('formats tool start and done events with human-friendly descriptions', () => {
      const toolStart = parseStreamJsonEvent(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            state: 'ACTIVE',
            step_type: 'tool',
            tool_name: 'view_file',
            tool_info: { name: 'view_file', parameters: { AbsolutePath: '/path/to/runner.ts' } },
          },
        })
      )!;

      const formattedStart = formatVerboseEvent(toolStart);
      expect(formattedStart).toContain('[tool:start]');
      expect(formattedStart).toContain('view_file');
      expect(formattedStart).toContain('Reading runner.ts');

      const toolDone = parseStreamJsonEvent(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            state: 'DONE',
            step_type: 'tool',
            tool_name: 'view_file',
            duration_seconds: 0.3,
          },
        })
      )!;

      const formattedDone = formatVerboseEvent(toolDone);
      expect(formattedDone).toContain('[tool:done]');
      expect(formattedDone).toContain('view_file');
      expect(formattedDone).toContain('0.3s');
    });

    it('formats result event with token metrics', () => {
      const resultEvent = parseStreamJsonEvent(
        JSON.stringify({
          event: 'result',
          result: {
            status: 'SUCCESS',
            duration_seconds: 45.2,
            usage: { total_tokens: 28400 },
          },
        })
      )!;

      const formatted = formatVerboseEvent(resultEvent);
      expect(formatted).toContain('[result]');
      expect(formatted).toContain('SUCCESS');
      expect(formatted).toContain('45.2s');
      expect(formatted).toContain('28,400 tokens');
    });
  });

  describe('Routine Run Issue Lifecycle (runner:local)', () => {
    it('gracefully returns undefined when gh issue create fails or is offline', () => {
      // Pass a non-existent or invalid directory to trigger failure
      const result = tryCreateLocalRunIssue(
        '/dev/null/invalid-dir',
        'autowork',
        '2026-09-13T12-00-00Z',
        'autowork',
        'test-host'
      );
      expect(result).toBeUndefined();
    });

    it('gracefully handles errors in tryReconcileLocalRunIssue without throwing', () => {
      expect(() => {
        tryReconcileLocalRunIssue(
          '/dev/null/invalid-dir',
          9999,
          '# Report',
          0,
          'test-host'
        );
      }).not.toThrow();
    });

    it('gracefully handles errors in tryReconcileLocalRunIssueAsync without throwing', async () => {
      const result = await tryReconcileLocalRunIssueAsync(
        '/dev/null/invalid-dir',
        9999,
        '# Report',
        0,
        'test-host'
      );
      expect(result).toBe(false);
    });

    it('gracefully handles errors in tryMarkLocalRunInterruptedAsync without throwing', async () => {
      const result = await tryMarkLocalRunInterruptedAsync(
        '/dev/null/invalid-dir',
        9999,
        'test-host'
      );
      expect(result).toBe(false);
    });

    it('gracefully handles errors in tryPostLocalRunMilestoneAsync without throwing', async () => {
      const result = await tryPostLocalRunMilestoneAsync(
        '/dev/null/invalid-dir',
        9999,
        'card'
      );
      expect(result).toBe(false);
    });

    it('formats a compact milestone card conforming to the 5-point schema', () => {
      const card = formatMilestoneCard({
        emoji: '🧭',
        milestoneTitle: 'Intake & Strategy',
        phase: 'Phase 1 · Target Selection & Planning',
        status: '⏳ In Progress',
        targetOrContext: '#124 (Fix token refresh in auth client)',
        keyDecisionOrFinding: 'Identified race condition in token-store.ts. Adding failing regression test first.',
        next: 'Implementation & Test Verification',
      });

      expect(card).toContain('### 🧭 Milestone: Intake & Strategy');
      expect(card).toContain('- **Phase**: `Phase 1 · Target Selection & Planning`');
      expect(card).toContain('- **Status**: ⏳ In Progress');
      expect(card).toContain('- **Target / Context**: `#124 (Fix token refresh in auth client)`');
      expect(card).toContain('- **Key Decision / Finding**: Identified race condition in token-store.ts. Adding failing regression test first.');
      expect(card).toContain('- **Next**: Implementation & Test Verification');
    });

    it('formats an interruption card for failed/interrupted runs', () => {
      const card = formatInterruptionCard({
        routine: 'autowork',
        status: 'failure',
        step: 'Run Autowork agy step',
        logUrl: 'https://github.com/org/repo/actions/runs/12345',
      });

      expect(card).toContain('### ❌ Milestone: Run Interrupted / Failed');
      expect(card).toContain('- **Routine**: `autowork`');
      expect(card).toContain('- **Status**: Routine execution interrupted or failed (`failure`)');
      expect(card).toContain('- **Step**: Run Autowork agy step');
      expect(card).toContain('- **Action Log**: [View Run Logs](https://github.com/org/repo/actions/runs/12345)');
    });

    it('gracefully handles errors in tryPostLocalRunMilestone without throwing', () => {
      expect(() => {
        tryPostLocalRunMilestone(
          '/dev/null/invalid-dir',
          9999,
          '### 🧭 Milestone: Test'
        );
      }).not.toThrow();
    });
  });

  describe('extractFreshRunReport & Stale Report Guardrails', () => {
    it('reads fresh execution report when created during routine', () => {
      const execDir = path.join(tmpRepo, 'exec');
      const targetDir = path.join(tmpRepo, 'target');
      fs.mkdirSync(path.join(execDir, '.jonah-fleet'), { recursive: true });
      fs.mkdirSync(path.join(targetDir, '.jonah-fleet'), { recursive: true });

      const execReport = path.join(execDir, '.jonah-fleet', 'run-report.md');
      const targetReport = path.join(targetDir, '.jonah-fleet', 'run-report.md');
      fs.writeFileSync(execReport, '# Fresh Execution Report', 'utf8');

      const startTime = Date.now() - 5000;
      const report = extractFreshRunReport(execReport, targetReport, startTime);
      expect(report).toBe('# Fresh Execution Report');
    });

    it('reads fresh target report when execution report does not exist', () => {
      const execDir = path.join(tmpRepo, 'exec');
      const targetDir = path.join(tmpRepo, 'target');
      fs.mkdirSync(path.join(targetDir, '.jonah-fleet'), { recursive: true });

      const execReport = path.join(execDir, '.jonah-fleet', 'run-report.md');
      const targetReport = path.join(targetDir, '.jonah-fleet', 'run-report.md');
      fs.writeFileSync(targetReport, '# Fresh Target Report', 'utf8');

      const startTime = Date.now() - 5000;
      const report = extractFreshRunReport(execReport, targetReport, startTime);
      expect(report).toBe('# Fresh Target Report');
    });

    it('ignores stale report modified prior to routine startTime', () => {
      const execDir = path.join(tmpRepo, 'exec');
      const targetDir = path.join(tmpRepo, 'target');
      fs.mkdirSync(path.join(targetDir, '.jonah-fleet'), { recursive: true });

      const execReport = path.join(execDir, '.jonah-fleet', 'run-report.md');
      const targetReport = path.join(targetDir, '.jonah-fleet', 'run-report.md');
      fs.writeFileSync(targetReport, '# Stale Report From Yesterday', 'utf8');

      // Backdate the file mtime by 1 hour
      const pastTime = new Date(Date.now() - 3600 * 1000);
      fs.utimesSync(targetReport, pastTime, pastTime);

      const startTime = Date.now() - 5000;
      const report = extractFreshRunReport(execReport, targetReport, startTime);
      expect(report).toBeNull();
    });

    it('returns null when neither execution nor target report exists', () => {
      const execReport = path.join(tmpRepo, 'non-existent-exec', '.jonah-fleet', 'run-report.md');
      const targetReport = path.join(tmpRepo, 'non-existent-target', '.jonah-fleet', 'run-report.md');

      const report = extractFreshRunReport(execReport, targetReport, Date.now() - 5000);
      expect(report).toBeNull();
    });
  });

  describe('resolveExitCode', () => {
    it('returns code when code is non-null and no signal', () => {
      expect(resolveExitCode(0, null)).toBe(0);
      expect(resolveExitCode(1, null)).toBe(1);
      expect(resolveExitCode(127, null)).toBe(127);
    });

    it('returns non-zero exit code (1) when code is null and process was killed by a signal', () => {
      expect(resolveExitCode(null, 'SIGTERM')).toBe(1);
      expect(resolveExitCode(null, 'SIGINT')).toBe(1);
      expect(resolveExitCode(null, 'SIGKILL')).toBe(1);
    });

    it('returns 0 when code is null and signal is null or undefined', () => {
      expect(resolveExitCode(null, null)).toBe(0);
      expect(resolveExitCode(null, undefined as any)).toBe(0);
    });

    it('preserves numeric exit code even if signal is present', () => {
      expect(resolveExitCode(130, 'SIGINT')).toBe(130);
    });
  });

  describe('formatFallbackRunReport & Stderr Diagnostics', () => {
    it('formats a successful run summary table without error output block when exitCode is 0', () => {
      const report = formatFallbackRunReport({
        routine: 'autowork',
        timestamp: '2026-09-16T12-00-00Z',
        exitCode: 0,
        hostname: 'test-runner',
        targetLabel: 'Issue #171',
        durationSec: 42,
        output: 'Completed successfully',
        stderr: '',
      });

      expect(report).toContain('## Run Summary');
      expect(report).toContain('| Result | `SUCCESS` |');
      expect(report).toContain('| Exit Code | `0` |');
      expect(report).toContain('| Host | `test-runner` |');
      expect(report).toContain('| Target | `Issue #171` |');
      expect(report).toContain('| Duration | `42s` |');
      expect(report).not.toContain('### Error Output');
    });

    it('includes stderr in Error Output when exitCode is non-zero even if stdout is empty', () => {
      const report = formatFallbackRunReport({
        routine: 'autowork',
        timestamp: '2026-09-16T12-00-00Z',
        exitCode: 1,
        hostname: 'test-runner',
        targetLabel: 'Issue #171',
        durationSec: 10,
        output: '',
        stderr: 'Error: Cannot find module agy\n    at Function.execute (cli.js:12:3)',
      });

      expect(report).toContain('| Result | `FAILURE` |');
      expect(report).toContain('| Exit Code | `1` |');
      expect(report).toContain('### Error Output');
      expect(report).toContain('Error: Cannot find module agy');
      expect(report).toContain('at Function.execute (cli.js:12:3)');
    });

    it('combines stdout and stderr and trims to trailing 15 lines', () => {
      const stdoutLines = Array.from({ length: 10 }, (_, i) => `stdout line ${i + 1}`).join('\n');
      const stderrLines = Array.from({ length: 10 }, (_, i) => `stderr line ${i + 1}`).join('\n');

      const report = formatFallbackRunReport({
        routine: 'peer-review',
        timestamp: '2026-09-16T12-00-00Z',
        exitCode: 1,
        hostname: 'test-runner',
        targetLabel: 'PR #100',
        durationSec: 15,
        output: stdoutLines,
        stderr: stderrLines,
      });

      expect(report).toContain('### Error Output');
      // Total 20 lines, should only contain the trailing 15 lines
      expect(report).not.toContain('stdout line 1\n');
      expect(report).not.toContain('stdout line 5\n');
      expect(report).toContain('stdout line 6');
      expect(report).toContain('stderr line 10');
    });

    it('strips ANSI color escape sequences from error output', () => {
      const report = formatFallbackRunReport({
        routine: 'autowork',
        timestamp: '2026-09-16T12-00-00Z',
        exitCode: 1,
        hostname: 'test-runner',
        targetLabel: 'Issue #171',
        durationSec: 5,
        output: '',
        stderr: '\u001b[31mFatal error:\u001b[39m \u001b[1mProcess crashed\u001b[22m',
      });

      expect(report).toContain('### Error Output');
      expect(report).toContain('Fatal error: Process crashed');
      expect(report).not.toContain('\u001b[31m');
    });

    it('omits Error Output block when exitCode is non-zero but output and stderr are empty', () => {
      const report = formatFallbackRunReport({
        routine: 'autowork',
        timestamp: '2026-09-16T12-00-00Z',
        exitCode: 1,
        hostname: 'test-runner',
        targetLabel: 'Issue #171',
        durationSec: 5,
        output: '   ',
        stderr: '',
      });

      expect(report).toContain('| Result | `FAILURE` |');
      expect(report).toContain('| Exit Code | `1` |');
      expect(report).not.toContain('### Error Output');
    });
  });

  describe('detectPrematureRoutineExit', () => {
    it('detects premature turn yield when agent output indicates verification in progress', () => {
      const output = 'Verification is in progress. Once TypeScript checks finish, the test suite and subagent review passes will execute.';
      const result = detectPrematureRoutineExit(output, 'peer-review');
      expect(result).toContain('Premature session termination');
      expect(result).toContain('Agent yielded turn on background task');
    });

    it('detects premature turn yield when agent output indicates waiting for test run to finish', () => {
      const output = 'I have started running the test suite on the base repository.\nWaiting for test run to finish.';
      const result = detectPrematureRoutineExit(output, 'peer-review');
      expect(result).toContain('Premature session termination');
    });

    it('detects premature exit when peer-review claimed a PR but took no terminal action', () => {
      const output = 'Starting review (round 1) · Run Log #4292\nInspected diff and files.';
      const result = detectPrematureRoutineExit(output, 'peer-review');
      expect(result).toContain('Premature peer-review termination');
      expect(result).toContain('without executing terminal action');
    });

    it('returns null when peer-review executed a squash-merge', () => {
      const output = 'Starting review (round 1)\nRan verification checks.\nSquash-merged PR #105 into main.';
      const result = detectPrematureRoutineExit(output, 'peer-review');
      expect(result).toBeNull();
    });

    it('returns null when peer-review converted PR back to draft with findings', () => {
      const output = 'Starting review (round 1)\nFound blocking security flaw.\ngh pr ready 105 --undo\nConverted PR #105 back to draft.';
      const result = detectPrematureRoutineExit(output, 'peer-review');
      expect(result).toBeNull();
    });

    it('returns null when peer-review completed with milestone card', () => {
      const output = 'Starting review (round 1)\n### 🏁 Milestone: Run Completed\n- **Status**: ✅ SUCCESS\n- **Key Decision / Finding**: Review completed with decision `MERGE`.';
      const result = detectPrematureRoutineExit(output, 'peer-review');
      expect(result).toBeNull();
    });

    it('returns null when output is empty or routine has no premature patterns', () => {
      expect(detectPrematureRoutineExit('', 'peer-review')).toBeNull();
      expect(detectPrematureRoutineExit('Clean autowork run completed.', 'autowork')).toBeNull();
    });
  });
});

