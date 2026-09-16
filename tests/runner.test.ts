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
  tryPostLocalRunMilestone,
  formatMilestoneCard,
  formatInterruptionCard,
  extractFreshRunReport,
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
});

