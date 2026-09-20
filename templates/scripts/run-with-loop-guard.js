#!/usr/bin/env node

/**
 * Deterministic Execution Wrapper Script for Antigravity CLI (agy)
 *
 * Intercepts runner stdout/stderr in real-time to enforce:
 * - Repetition Guard: Kills process on 5 identical action hashes within sliding window
 * - Ping-Pong Guard: Kills process on 3 consecutive alternating action pairs (A-B-A-B-A-B)
 * - Tool Circuit Breaker: Kills process on 2 consecutive identical tool call errors
 *
 * On trip, emits a structured failure card with category `loop_circuit_breaker`
 * and writes `.jonah-fleet/run-report.md` before exiting with non-zero status.
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function canonicalStringify(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`);
  return '{' + entries.join(',') + '}';
}

export function computeActionHash(toolName, args) {
  const canonicalArgs = canonicalStringify(args);
  return crypto.createHash('sha256').update(`${toolName}:${canonicalArgs}`).digest('hex');
}

export class LoopGuard {
  constructor(options = {}) {
    this.repetitionThreshold = options.repetitionThreshold ?? 5;
    this.pingPongThreshold = options.pingPongThreshold ?? 3;
    this.consecutiveErrorThreshold = options.consecutiveErrorThreshold ?? 2;
    this.slidingWindowSize = options.slidingWindowSize ?? 20;
    this.onTrip = options.onTrip;

    this.history = [];
    this.lastErrorHash = null;
    this.consecutiveErrorCount = 0;
    this.trippedResult = null;
  }

  isTripped() {
    return this.trippedResult !== null;
  }

  getTrip() {
    return this.trippedResult;
  }

  recordAction(toolName, args, isError = false) {
    if (this.trippedResult) return this.trippedResult;

    const isStatusPolling =
      (toolName === 'manage_task' &&
        (args?.Action === 'status' ||
          args?.action === 'status' ||
          args?.Action === 'list' ||
          args?.action === 'list')) ||
      (toolName === 'manage_subagents' &&
        (args?.Action === 'list' ||
          args?.action === 'list'));

    const hash = computeActionHash(toolName, args);
    const record = {
      toolName,
      args,
      hash,
      isError,
      timestamp: Date.now(),
    };

    // 1. Tool Circuit Breaker Guard
    if (isError) {
      if (this.lastErrorHash === hash) {
        this.consecutiveErrorCount++;
      } else {
        this.lastErrorHash = hash;
        this.consecutiveErrorCount = 1;
      }

      if (this.consecutiveErrorCount >= this.consecutiveErrorThreshold) {
        return this.triggerTrip({
          reason: 'consecutive_errors',
          message: `Tool circuit breaker tripped: ${this.consecutiveErrorCount} consecutive identical tool errors for '${toolName}' with unchanged arguments.`,
          toolName,
          actionHash: hash,
          count: this.consecutiveErrorCount,
        });
      }
    } else {
      this.lastErrorHash = null;
      this.consecutiveErrorCount = 0;
    }

    this.history.push(record);

    // 2. Repetition Guard within sliding window
    if (!isStatusPolling) {
      const windowStart = Math.max(0, this.history.length - this.slidingWindowSize);
      const currentWindow = this.history.slice(windowStart);

      let repetitionCount = 0;
      for (const item of currentWindow) {
        if (item.hash === hash) {
          repetitionCount++;
        }
      }

      if (repetitionCount >= this.repetitionThreshold) {
        return this.triggerTrip({
          reason: 'repetition',
          message: `Action repetition loop detected: tool '${toolName}' called ${repetitionCount} times with identical parameters within sliding window of ${this.slidingWindowSize}.`,
          toolName,
          actionHash: hash,
          count: repetitionCount,
        });
      }
    }

    // 3. Ping-Pong Guard: 3 consecutive alternating pairs (length 6)
    const requiredPingPongLength = this.pingPongThreshold * 2;
    if (this.history.length >= requiredPingPongLength) {
      const pingPongSlice = this.history.slice(-requiredPingPongLength);
      const hasStatusPolling = pingPongSlice.some(
        (item) =>
          (item.toolName === 'manage_task' &&
            (item.args?.Action === 'status' ||
              item.args?.action === 'status' ||
              item.args?.Action === 'list' ||
              item.args?.action === 'list')) ||
          (item.toolName === 'manage_subagents' &&
            (item.args?.Action === 'list' ||
              item.args?.action === 'list'))
      );

      if (!hasStatusPolling) {
        const hashA = pingPongSlice[0].hash;
        const hashB = pingPongSlice[1].hash;

        if (hashA !== hashB) {
          let isPingPong = true;
          for (let i = 0; i < requiredPingPongLength; i++) {
            const expectedHash = i % 2 === 0 ? hashA : hashB;
            if (pingPongSlice[i].hash !== expectedHash) {
              isPingPong = false;
              break;
            }
          }

          if (isPingPong) {
            return this.triggerTrip({
              reason: 'ping_pong',
              message: `Alternating ping-pong action loop detected: ${this.pingPongThreshold} consecutive alternating cycles between tools (A-B-A-B-A-B).`,
              toolName,
              actionHash: hash,
              count: this.pingPongThreshold,
            });
          }
        }
      }
    }

    return null;
  }

  feedLine(line) {
    if (!line || !line.trim()) return null;
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed && typeof parsed === 'object' && parsed.event === 'step_update') {
        const su = parsed.step_update;
        if (su && su.step_type === 'tool') {
          const toolName = su.tool_name || su.tool_info?.name || 'unknown';
          const params = su.tool_info?.parameters;

          if (su.state === 'ACTIVE') {
            return this.recordAction(toolName, params, false);
          }
          if (su.state === 'ERROR') {
            return this.recordAction(toolName, params, true);
          }
        }
      }
    } catch {}
    return null;
  }

  triggerTrip(trip) {
    this.trippedResult = trip;
    if (this.onTrip) {
      try {
        this.onTrip(trip);
      } catch {}
    }
    return trip;
  }
}

export function formatLoopGuardFailureCard(options) {
  const serverUrl = options.serverUrl || process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repository = options.repository || process.env.GITHUB_REPOSITORY || '';
  const runId = options.runId || process.env.GITHUB_RUN_ID || '';
  const logUrl = runId && repository ? `${serverUrl}/${repository}/actions/runs/${runId}` : '';

  const lines = [
    `### ❌ Milestone: Run Interrupted / Failed`,
    `- **Routine**: \`${options.routine}\``,
    `- **Status**: Loop guard circuit breaker tripped (\`loop_circuit_breaker\`)`,
    `- **Root Cause Category**: \`loop_circuit_breaker\``,
    `- **Trigger**: \`${options.trip.reason}\``,
    `- **Reason**: ${options.trip.message}`,
    `- **Action**: Process terminated to prevent runaway token burn`,
  ];

  if (logUrl) {
    lines.push(`- **Action Log**: [View Run Logs](${logUrl})`);
  }

  return lines.join('\n');
}

export function formatLoopGuardReport(options) {
  return [
    `# Run Report`,
    ``,
    `## Result`,
    `FAILURE`,
    ``,
    `## Summary`,
    `| Metric | Value |`,
    `|---|---|`,
    `| Routine | \`${options.routine}\` |`,
    `| Timestamp | \`${options.timestamp}\` |`,
    `| Result | \`FAILURE\` |`,
    `| Category | \`loop_circuit_breaker\` |`,
    `| Trigger | \`${options.trip.reason}\` |`,
    `| Tool | \`${options.trip.toolName}\` |`,
    `| Action Hash | \`${options.trip.actionHash}\` |`,
    ``,
    `### Failure Details`,
    `The autonomous execution was halted by the deterministic loop-guard wrapper.`,
    `- **Category**: \`loop_circuit_breaker\``,
    `- **Trigger**: \`${options.trip.reason}\``,
    `- **Tool**: \`${options.trip.toolName}\``,
    `- **Action Hash**: \`${options.trip.actionHash}\``,
    `- **Message**: ${options.trip.message}`,
  ].join('\n');
}

class LineParser {
  constructor(onLine) {
    this.buffer = '';
    this.onLine = onLine;
  }

  feed(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length > 0) {
        this.onLine(line);
      }
    }
  }

  flush() {
    if (this.buffer.trim().length > 0) {
      this.onLine(this.buffer);
      this.buffer = '';
    }
  }
}

/**
 * Main execution logic when invoked as CLI script.
 */
async function main() {
  const rawArgs = process.argv.slice(2);
  const commandArgs = rawArgs[0] === 'agy' ? rawArgs.slice(1) : rawArgs;

  // Detect routine name from environment or prompt
  const routine = process.env.ROUTINE || 'autowork';
  const routineIssueNumber = process.env.ROUTINE_ISSUE_NUMBER;
  const cwd = process.cwd();

  // Ensure --output-format stream-json is configured so tool calls can be inspected
  const finalArgs = [];
  let hasOutputFormat = false;
  let requestedTextFormat = false;

  for (let i = 0; i < commandArgs.length; i++) {
    const arg = commandArgs[i];
    if (arg === '--output-format') {
      hasOutputFormat = true;
      const nextArg = commandArgs[i + 1];
      if (nextArg === 'text') {
        requestedTextFormat = true;
      }
      finalArgs.push('--output-format', 'stream-json');
      i++;
    } else {
      finalArgs.push(arg);
    }
  }

  if (!hasOutputFormat) {
    finalArgs.push('--output-format', 'stream-json');
  }

  let childProcess = null;
  let tripped = null;

  const guard = new LoopGuard({
    repetitionThreshold: 5,
    pingPongThreshold: 3,
    consecutiveErrorThreshold: 2,
    slidingWindowSize: 20,
    onTrip: (trip) => {
      tripped = trip;
      console.error(`\n🚨 ::error::[LoopGuard] ${trip.message}`);

      if (childProcess && !childProcess.killed) {
        console.error(`🛑 Terminating runner process with SIGTERM...`);
        childProcess.kill('SIGTERM');

        const killTimer = setTimeout(() => {
          if (childProcess && !childProcess.killed) {
            console.error(`🛑 Runner did not terminate; sending SIGKILL...`);
            try {
              childProcess.kill('SIGKILL');
            } catch {}
          }
        }, 3000);
        killTimer.unref();
      }
    },
  });

  const stdoutParser = new LineParser((line) => {
    guard.feedLine(line);

    try {
      const parsed = JSON.parse(line.trim());
      if (parsed && typeof parsed === 'object') {
        if (parsed.event === 'step_update' && parsed.step_update) {
          const su = parsed.step_update;
          if (su.step_type === 'agent_response' || su.step_type === 'thought') {
            if (su.text_delta) {
              process.stdout.write(su.text_delta);
            }
          } else if (su.step_type === 'tool') {
            const name = su.tool_name || su.tool_info?.name || 'tool';
            if (su.state === 'ACTIVE') {
              console.log(`\n[tool:start] ${name}`);
            } else if (su.state === 'DONE') {
              console.log(`[tool:done] ${name}`);
            } else if (su.state === 'ERROR') {
              console.log(`[tool:error] ${name}`);
            }
          }
        } else if (parsed.event === 'result' && parsed.result?.response) {
          console.log(`\n${parsed.result.response}\n`);
        }
        return;
      }
    } catch {}

    // Non-JSON line from stdout: print directly
    console.log(line);
  });

  const stderrParser = new LineParser((line) => {
    guard.feedLine(line);
    console.error(line);
  });

  const runnerBinEnv = process.env.RUNNER_BIN || 'agy';
  const [command, ...prefixArgs] = runnerBinEnv.split(' ');
  const execArgs = [...prefixArgs, ...finalArgs];

  const exitCode = await new Promise((resolve) => {
    childProcess = spawn(command, execArgs, {
      cwd,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    childProcess.stdout?.on('data', (chunk) => stdoutParser.feed(chunk.toString()));
    childProcess.stderr?.on('data', (chunk) => stderrParser.feed(chunk.toString()));

    childProcess.on('close', (code, signal) => {
      stdoutParser.flush();
      stderrParser.flush();
      resolve(code ?? (signal ? 1 : 0));
    });

    childProcess.on('error', (err) => {
      console.error(`Failed to launch '${command}':`, err.message);
      resolve(1);
    });
  });

  if (tripped) {
    const timestamp = new Date().toISOString();
    const logDir = path.join(cwd, '.jonah-fleet');
    fs.mkdirSync(logDir, { recursive: true });
    const reportPath = path.join(logDir, 'run-report.md');

    const reportContent = formatLoopGuardReport({
      routine,
      timestamp,
      trip: tripped,
    });
    fs.writeFileSync(reportPath, reportContent, 'utf8');

    if (routineIssueNumber) {
      try {
        const failureCard = formatLoopGuardFailureCard({
          routine,
          trip: tripped,
          runId: process.env.GITHUB_RUN_ID,
          serverUrl: process.env.GITHUB_SERVER_URL,
          repository: process.env.GITHUB_REPOSITORY,
        });
        const tmpFile = path.join(os.tmpdir(), `loop-guard-card-${Date.now()}.md`);
        fs.writeFileSync(tmpFile, failureCard, 'utf8');
        try {
          execSync(`gh issue comment ${routineIssueNumber} --body-file ${JSON.stringify(tmpFile)}`, {
            cwd,
            stdio: 'ignore',
          });
        } finally {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        }
      } catch (err) {
        console.error('Failed to post failure card to tracking issue:', err.message);
      }
    }

    process.exit(1);
  }

  process.exit(exitCode);
}

if (process.argv[1] && process.argv[1].endsWith('run-with-loop-guard.js')) {
  main().catch((err) => {
    console.error('Fatal wrapper error:', err);
    process.exit(1);
  });
}
