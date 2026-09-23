import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeActionHash,
  canonicalStringify,
  LoopGuard,
  formatActionSummary,
  formatLoopGuardFailureCard,
  formatLoopGuardReport,
} from '../src/lib/loop-guard.js';

describe('LoopGuard & Action Repetition Circuit Breaker', () => {
  describe('Action Hash Calculation', () => {
    it('computes deterministic SHA-256 action hash from tool name and arguments', () => {
      const hash1 = computeActionHash('view_file', { AbsolutePath: '/foo/bar.ts' });
      const hash2 = computeActionHash('view_file', { AbsolutePath: '/foo/bar.ts' });
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces identical hashes regardless of object key ordering', () => {
      const hashA = computeActionHash('run_command', { CommandLine: 'npm test', Cwd: '/app' });
      const hashB = computeActionHash('run_command', { Cwd: '/app', CommandLine: 'npm test' });
      expect(hashA).toBe(hashB);
    });

    it('produces different hashes for different tool names or arguments', () => {
      const hash1 = computeActionHash('view_file', { AbsolutePath: '/foo/bar.ts' });
      const hash2 = computeActionHash('view_file', { AbsolutePath: '/foo/baz.ts' });
      const hash3 = computeActionHash('edit_file', { AbsolutePath: '/foo/bar.ts' });
      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it('handles primitives, empty arguments, and nested objects safely', () => {
      expect(computeActionHash('tool', null)).toMatch(/^[a-f0-9]{64}$/);
      expect(computeActionHash('tool', undefined)).toMatch(/^[a-f0-9]{64}$/);
      expect(computeActionHash('tool', {})).toMatch(/^[a-f0-9]{64}$/);
      expect(computeActionHash('tool', { nested: { b: 2, a: 1 } })).toBe(
        computeActionHash('tool', { nested: { a: 1, b: 2 } })
      );
    });
  });

  describe('Repetition Guard (Threshold = 5)', () => {
    it('trips when the same action occurs 5 times within sliding window', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5, slidingWindowSize: 10 });
      const tool = 'run_command';
      const args = { CommandLine: 'npm test' };

      expect(guard.recordAction(tool, args)).toBeNull();
      expect(guard.recordAction(tool, args)).toBeNull();
      expect(guard.recordAction(tool, args)).toBeNull();
      expect(guard.recordAction(tool, args)).toBeNull();

      const trip = guard.recordAction(tool, args);
      expect(trip).not.toBeNull();
      expect(trip?.reason).toBe('repetition');
      expect(trip?.toolName).toBe('run_command');
      expect(trip?.count).toBe(5);
      expect(trip?.args).toEqual(args);
      expect(guard.isTripped()).toBe(true);
    });

    it('does not trip when action repetition is below threshold 5', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5, slidingWindowSize: 10 });
      for (let i = 0; i < 4; i++) {
        expect(guard.recordAction('run_command', { CommandLine: 'ls' })).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);
    });

    it('does not trip when repetitions fall outside the sliding window', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5, slidingWindowSize: 5 });
      // Repeat 4 times
      for (let i = 0; i < 4; i++) {
        guard.recordAction('run_command', { CommandLine: 'ls' });
      }
      // Interleave different actions to push old ones out of window of 5
      for (let i = 0; i < 5; i++) {
        guard.recordAction('other_tool', { id: i });
      }
      // Now a 5th occurrence of 'ls' is the only one in window
      const trip = guard.recordAction('run_command', { CommandLine: 'ls' });
      expect(trip).toBeNull();
      expect(guard.isTripped()).toBe(false);
    });

    it('exempts manage_task status and list polling from repetition trip', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5, slidingWindowSize: 20 });
      // Calling manage_task status 10 times in a row should NOT trip repetition
      for (let i = 0; i < 10; i++) {
        expect(guard.recordAction('manage_task', { Action: 'status', TaskId: 'task-123' })).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);

      // Calling manage_task list 10 times in a row should also NOT trip repetition
      for (let i = 0; i < 10; i++) {
        expect(guard.recordAction('manage_task', { Action: 'list' })).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);
    });

    it('exempts manage_subagents list polling from repetition trip', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5, slidingWindowSize: 20 });
      for (let i = 0; i < 10; i++) {
        expect(guard.recordAction('manage_subagents', { Action: 'list' })).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);
    });

    it('exempts view_file and read_file inspections from repetition trip', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5, slidingWindowSize: 20 });
      for (let i = 0; i < 10; i++) {
        expect(guard.recordAction('view_file', { AbsolutePath: '/path/to/daemon.ts' })).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);

      for (let i = 0; i < 10; i++) {
        expect(guard.recordAction('read_file', { path: 'src/lib/daemon.ts' })).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);
    });
  });

  describe('Ping-Pong Guard (Threshold = 3 alternating pairs, 6 actions)', () => {
    it('trips when 3 consecutive alternating action pairs occur (A-B-A-B-A-B)', () => {
      const guard = new LoopGuard({ pingPongThreshold: 3 });
      const actionA = { tool: 'view_file', args: { path: 'a.ts' } };
      const actionB = { tool: 'view_file', args: { path: 'b.ts' } };

      expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull(); // A (1)
      expect(guard.recordAction(actionB.tool, actionB.args)).toBeNull(); // B (1)
      expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull(); // A (2)
      expect(guard.recordAction(actionB.tool, actionB.args)).toBeNull(); // B (2)
      expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull(); // A (3)

      const trip = guard.recordAction(actionB.tool, actionB.args); // B (3) -> 6 actions, 3 pairs
      expect(trip).not.toBeNull();
      expect(trip?.reason).toBe('ping_pong');
      expect(trip?.args).toEqual(actionB.args);
      expect(guard.isTripped()).toBe(true);
    });

    it('exempts manage_task status and list polling from ping-pong trip', () => {
      const guard = new LoopGuard({ pingPongThreshold: 3 });
      const actionA = { tool: 'schedule', args: { DurationSeconds: 60 } };
      const actionB = { tool: 'manage_task', args: { Action: 'status', TaskId: 'task-1' } };

      // Alternate 4 pairs between schedule and manage_task status
      for (let i = 0; i < 4; i++) {
        expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull();
        expect(guard.recordAction(actionB.tool, actionB.args)).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);
    });

    it('exempts manage_subagents list polling from ping-pong trip', () => {
      const guard = new LoopGuard({ pingPongThreshold: 3 });
      const actionA = { tool: 'manage_task', args: { Action: 'status', TaskId: 'task-1' } };
      const actionB = { tool: 'manage_subagents', args: { Action: 'list' } };

      for (let i = 0; i < 4; i++) {
        expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull();
        expect(guard.recordAction(actionB.tool, actionB.args)).toBeNull();
      }
      expect(guard.isTripped()).toBe(false);
    });

    it('does not trip on 2 alternating pairs (A-B-A-B)', () => {
      const guard = new LoopGuard({ pingPongThreshold: 3 });
      const actionA = { tool: 'view_file', args: { path: 'a.ts' } };
      const actionB = { tool: 'view_file', args: { path: 'b.ts' } };

      expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull();
      expect(guard.recordAction(actionB.tool, actionB.args)).toBeNull();
      expect(guard.recordAction(actionA.tool, actionA.args)).toBeNull();
      expect(guard.recordAction(actionB.tool, actionB.args)).toBeNull();
      expect(guard.isTripped()).toBe(false);
    });

    it('does not trip if cycle is broken by a third distinct action', () => {
      const guard = new LoopGuard({ pingPongThreshold: 3 });
      const actionA = { tool: 'view_file', args: { path: 'a.ts' } };
      const actionB = { tool: 'view_file', args: { path: 'b.ts' } };
      const actionC = { tool: 'view_file', args: { path: 'c.ts' } };

      guard.recordAction(actionA.tool, actionA.args);
      guard.recordAction(actionB.tool, actionB.args);
      guard.recordAction(actionA.tool, actionA.args);
      guard.recordAction(actionB.tool, actionB.args);
      guard.recordAction(actionC.tool, actionC.args); // Breaks A-B sequence
      guard.recordAction(actionA.tool, actionA.args);
      guard.recordAction(actionB.tool, actionB.args);

      expect(guard.isTripped()).toBe(false);
    });
  });

  describe('Tool Circuit Breaker (Threshold = 2 consecutive identical errors)', () => {
    it('trips when 2 consecutive identical tool call errors occur with unchanged arguments', () => {
      const guard = new LoopGuard({ consecutiveErrorThreshold: 2 });
      const tool = 'run_command';
      const args = { CommandLine: 'cat missing.txt' };

      // First error
      expect(guard.recordAction(tool, args, true)).toBeNull();
      expect(guard.isTripped()).toBe(false);

      // Second identical error
      const trip = guard.recordAction(tool, args, true);
      expect(trip).not.toBeNull();
      expect(trip?.reason).toBe('consecutive_errors');
      expect(trip?.toolName).toBe('run_command');
      expect(trip?.count).toBe(2);
      expect(trip?.args).toEqual(args);
      expect(guard.isTripped()).toBe(true);
    });

    it('resets consecutive error counter if the action succeeds', () => {
      const guard = new LoopGuard({ consecutiveErrorThreshold: 2 });
      const tool = 'run_command';
      const args = { CommandLine: 'cat file.txt' };

      // First error
      expect(guard.recordAction(tool, args, true)).toBeNull();
      // Succeeds on second try
      expect(guard.recordAction(tool, args, false)).toBeNull();
      // Third try errors - should be count 1, not 2
      expect(guard.recordAction(tool, args, true)).toBeNull();
      expect(guard.isTripped()).toBe(false);
    });

    it('does not trip if consecutive errors occur with different arguments', () => {
      const guard = new LoopGuard({ consecutiveErrorThreshold: 2 });
      expect(guard.recordAction('run_command', { CommandLine: 'cat foo.txt' }, true)).toBeNull();
      expect(guard.recordAction('run_command', { CommandLine: 'cat bar.txt' }, true)).toBeNull();
      expect(guard.isTripped()).toBe(false);
    });

    it('trips on consecutive errors even for manage_task status polling', () => {
      const guard = new LoopGuard({ consecutiveErrorThreshold: 2 });
      const tool = 'manage_task';
      const args = { Action: 'status', TaskId: 'invalid-id' };

      expect(guard.recordAction(tool, args, true)).toBeNull();
      expect(guard.isTripped()).toBe(false);

      const trip = guard.recordAction(tool, args, true);
      expect(trip).not.toBeNull();
      expect(trip?.reason).toBe('consecutive_errors');
      expect(trip?.toolName).toBe('manage_task');
      expect(guard.isTripped()).toBe(true);
    });
  });

  describe('Stream JSON Line Parsing', () => {
    it('processes stream-json events from Antigravity runner', () => {
      const guard = new LoopGuard({ repetitionThreshold: 5 });
      const onTrip = vi.fn();
      guard.setOnTrip(onTrip);

      const makeEventLine = (tool: string, args: any) =>
        JSON.stringify({
          event: 'step_update',
          step_update: {
            step_type: 'tool',
            state: 'ACTIVE',
            tool_name: tool,
            tool_info: {
              name: tool,
              parameters: args,
            },
          },
        });

      for (let i = 0; i < 4; i++) {
        guard.feedLine(makeEventLine('grep_search', { Query: 'foo' }));
      }
      expect(onTrip).not.toHaveBeenCalled();

      guard.feedLine(makeEventLine('grep_search', { Query: 'foo' }));
      expect(onTrip).toHaveBeenCalledTimes(1);
      expect(guard.isTripped()).toBe(true);
    });

    it('tracks tool errors from stream-json events with state: ERROR', () => {
      const guard = new LoopGuard({ consecutiveErrorThreshold: 2 });

      const makeErrorLine = (tool: string, args: any) =>
        JSON.stringify({
          event: 'step_update',
          step_update: {
            step_type: 'tool',
            state: 'ERROR',
            tool_name: tool,
            tool_info: {
              name: tool,
              parameters: args,
              output: 'Error: File not found',
            },
          },
        });

      guard.feedLine(makeErrorLine('view_file', { AbsolutePath: '/no/file.txt' }));
      expect(guard.isTripped()).toBe(false);

      guard.feedLine(makeErrorLine('view_file', { AbsolutePath: '/no/file.txt' }));
      expect(guard.isTripped()).toBe(true);
      expect(guard.getTrip()?.reason).toBe('consecutive_errors');
      expect(guard.getTrip()?.args).toEqual({ AbsolutePath: '/no/file.txt' });
    });

    it('ignores non-json and non-tool lines gracefully', () => {
      const guard = new LoopGuard();
      expect(guard.feedLine('plain text log line')).toBeNull();
      expect(guard.feedLine('')).toBeNull();
      expect(guard.feedLine('{"event":"init"}')).toBeNull();
      expect(guard.feedLine('{"event":"step_update","step_update":{"step_type":"thought"}}')).toBeNull();
      expect(guard.isTripped()).toBe(false);
    });
  });

  describe('Card and Report Formatting', () => {
    it('formats a structured failure card with category loop_circuit_breaker and action details', () => {
      const card = formatLoopGuardFailureCard({
        routine: 'autowork',
        trip: {
          reason: 'repetition',
          message: 'Action repetition loop detected: tool run_command called 5 times with identical parameters.',
          toolName: 'run_command',
          actionHash: 'abc1234567890',
          count: 5,
          args: { CommandLine: 'git status' },
        },
        runId: '12345',
        serverUrl: 'https://github.com',
        repository: 'owner/repo',
      });

      expect(card).toContain('### ❌ Milestone: Run Interrupted / Failed');
      expect(card).toContain('- **Routine**: `autowork`');
      expect(card).toContain('- **Status**: Loop guard circuit breaker tripped (`loop_circuit_breaker`)');
      expect(card).toContain('- **Root Cause Category**: `loop_circuit_breaker`');
      expect(card).toContain('- **Trigger**: `repetition`');
      expect(card).toContain('Action repetition loop detected');
      expect(card).toContain('- **Triggered Action**: `run_command: git status`');
      expect(card).toContain('- **Action**: Process terminated to prevent runaway token burn');
      expect(card).toContain('[View Run Logs](https://github.com/owner/repo/actions/runs/12345)');
    });

    it('formats a fallback markdown run report on circuit breaker trip with action details', () => {
      const report = formatLoopGuardReport({
        routine: 'autowork',
        timestamp: '2026-09-18T12:00:00Z',
        trip: {
          reason: 'ping_pong',
          message: 'Alternating ping-pong action loop detected: 3 consecutive alternating cycles between tools (A-B-A-B-A-B).',
          toolName: 'view_file',
          actionHash: 'def9876543210',
          count: 3,
          args: { AbsolutePath: '/path/to/file.ts' },
        },
      });

      expect(report).toContain('# Run Report');
      expect(report).toContain('## Result');
      expect(report).toContain('FAILURE');
      expect(report).toContain('| Result | `FAILURE` |');
      expect(report).toContain('| Category | `loop_circuit_breaker` |');
      expect(report).toContain('- **Parameters**: `view_file: /path/to/file.ts`');
      expect(report).toContain('Alternating ping-pong action loop detected');
    });
  });

  describe('formatActionSummary', () => {
    it('formats tool arguments containing CommandLine, command, TargetFile, path, AbsolutePath, and Query', () => {
      expect(formatActionSummary('run_command', { CommandLine: 'npm test' })).toBe('run_command: npm test');
      expect(formatActionSummary('bash', { command: 'echo "hello world"' })).toBe('bash: echo "hello world"');
      expect(formatActionSummary('write_to_file', { TargetFile: '/path/to/file.ts' })).toBe('write_to_file: /path/to/file.ts');
      expect(formatActionSummary('read_file', { path: 'src/lib/loop-guard.ts' })).toBe('read_file: src/lib/loop-guard.ts');
      expect(formatActionSummary('view_file', { AbsolutePath: '/var/log/app.log' })).toBe('view_file: /var/log/app.log');
      expect(formatActionSummary('grep_search', { Query: 'LoopGuard' })).toBe('grep_search: LoopGuard');
    });

    it('formats raw string argument payloads', () => {
      expect(formatActionSummary('send_input', 'yes')).toBe('send_input: yes');
      expect(formatActionSummary('custom_tool', 'plain string payload')).toBe('custom_tool: plain string payload');
    });

    it('handles nullish and undefined argument payloads safely', () => {
      expect(formatActionSummary('get_me', null)).toBe('get_me');
      expect(formatActionSummary('get_me', undefined)).toBe('get_me');
      expect(formatActionSummary('get_me', '')).toBe('get_me');
      expect(formatActionSummary('get_me', false)).toBe('get_me');
      expect(formatActionSummary('get_me', 0)).toBe('get_me');
    });

    it('truncates canonicalized object arguments exceeding 200 characters', () => {
      const largePayload = { data: 'a'.repeat(250) };
      const canonical = canonicalStringify(largePayload);
      expect(canonical.length).toBeGreaterThan(200);

      const formatted = formatActionSummary('custom_tool', largePayload);
      expect(formatted).toBe(`custom_tool: ${canonical.slice(0, 197)}...`);
      expect(formatted.endsWith('...')).toBe(true);
      expect(formatted.length).toBe('custom_tool: '.length + 200);
    });

    it('formats non-truncated object arguments within 200 characters', () => {
      const smallPayload = { Action: 'status', TaskId: 'task-123' };
      expect(formatActionSummary('manage_task', smallPayload)).toBe(
        'manage_task: {"Action":"status","TaskId":"task-123"}'
      );
      expect(formatActionSummary('empty_tool', {})).toBe('empty_tool: {}');
    });

    it('respects parameter precedence ordering when multiple candidate keys exist', () => {
      expect(formatActionSummary('run_command', { CommandLine: 'first', command: 'second' })).toBe('run_command: first');
      expect(formatActionSummary('file_tool', { TargetFile: '/first.ts', path: '/second.ts' })).toBe('file_tool: /first.ts');
    });
  });
});

describe('Wrapper Script Execution Integration', () => {
  let tmpDir: string;
  const scriptPath = path.resolve('.github/scripts/run-with-loop-guard.js');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-loop-guard-exec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects action loop in child process output, aborts process, and generates failure report', async () => {
    // Create a mock runner script that emits 5 repeat tool events
    const mockRunnerPath = path.join(tmpDir, 'mock-runner.js');
    const mockCode = `
      const line = JSON.stringify({
        event: 'step_update',
        step_update: {
          step_type: 'tool',
          state: 'ACTIVE',
          tool_name: 'run_command',
          tool_info: { name: 'run_command', parameters: { CommandLine: 'npm test' } }
        }
      });
      for (let i = 0; i < 6; i++) {
        console.log(line);
      }
      setTimeout(() => process.exit(0), 5000);
    `;
    fs.writeFileSync(mockRunnerPath, mockCode, 'utf8');

    let childExited = false;
    let exitCode: number | null = null;

    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        cwd: tmpDir,
        env: {
          ...process.env,
          RUNNER_BIN: `${process.execPath} ${mockRunnerPath}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.on('close', (code) => {
        exitCode = code;
        childExited = true;
        resolve();
      });
    });

    expect(childExited).toBe(true);
    expect(exitCode).not.toBe(0);

    const reportPath = path.join(tmpDir, '.jonah-fleet', 'run-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);

    const reportContent = fs.readFileSync(reportPath, 'utf8');
    expect(reportContent).toContain('loop_circuit_breaker');
    expect(reportContent).toContain('Action repetition loop detected');
  });
});
