import crypto from 'node:crypto';

export type LoopGuardTripReason = 'repetition' | 'ping_pong' | 'consecutive_errors';

export interface LoopGuardTrip {
  reason: LoopGuardTripReason;
  message: string;
  toolName: string;
  actionHash: string;
  count: number;
}

export interface ActionRecord {
  toolName: string;
  args: any;
  hash: string;
  isError: boolean;
  timestamp: number;
}

export interface LoopGuardOptions {
  repetitionThreshold?: number;
  pingPongThreshold?: number;
  consecutiveErrorThreshold?: number;
  slidingWindowSize?: number;
  onTrip?: (trip: LoopGuardTrip) => void;
}

/**
 * Deterministically stringifies an object by recursively sorting its keys.
 */
export function canonicalStringify(value: any): string {
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

/**
 * Computes a deterministic SHA-256 action hash: SHA-256(tool_name + canonicalString(args))
 */
export function computeActionHash(toolName: string, args: any): string {
  const canonicalArgs = canonicalStringify(args);
  return crypto.createHash('sha256').update(`${toolName}:${canonicalArgs}`).digest('hex');
}

/**
 * Deterministic Loop Guard & Circuit Breaker monitoring tool calls and execution events.
 */
export class LoopGuard {
  private repetitionThreshold: number;
  private pingPongThreshold: number;
  private consecutiveErrorThreshold: number;
  private slidingWindowSize: number;
  private onTrip?: (trip: LoopGuardTrip) => void;

  private history: ActionRecord[] = [];
  private lastErrorHash: string | null = null;
  private consecutiveErrorCount: number = 0;
  private trippedResult: LoopGuardTrip | null = null;

  constructor(options: LoopGuardOptions = {}) {
    this.repetitionThreshold = options.repetitionThreshold ?? 5;
    this.pingPongThreshold = options.pingPongThreshold ?? 3;
    this.consecutiveErrorThreshold = options.consecutiveErrorThreshold ?? 2;
    this.slidingWindowSize = options.slidingWindowSize ?? 20;
    this.onTrip = options.onTrip;
  }

  public setOnTrip(callback: (trip: LoopGuardTrip) => void): void {
    this.onTrip = callback;
  }

  public isTripped(): boolean {
    return this.trippedResult !== null;
  }

  public getTrip(): LoopGuardTrip | null {
    return this.trippedResult;
  }

  public getHistory(): ActionRecord[] {
    return [...this.history];
  }

  public reset(): void {
    this.history = [];
    this.lastErrorHash = null;
    this.consecutiveErrorCount = 0;
    this.trippedResult = null;
  }

  /**
   * Records an action occurrence and evaluates repetition, ping-pong, and error guards.
   */
  public recordAction(toolName: string, args: any, isError: boolean = false): LoopGuardTrip | null {
    if (this.trippedResult) {
      return this.trippedResult;
    }

    const isStatusPolling =
      toolName === 'manage_task' &&
      (args?.Action === 'status' ||
        args?.action === 'status' ||
        args?.Action === 'list' ||
        args?.action === 'list');

    const hash = computeActionHash(toolName, args);
    const record: ActionRecord = {
      toolName,
      args,
      hash,
      isError,
      timestamp: Date.now(),
    };

    // 1. Tool Circuit Breaker Guard: Check consecutive identical tool errors
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
      // Successful execution resets the consecutive error counter
      this.lastErrorHash = null;
      this.consecutiveErrorCount = 0;
    }

    // Add to history
    this.history.push(record);

    // Maintain sliding window for repetition count
    const windowStart = Math.max(0, this.history.length - this.slidingWindowSize);
    const currentWindow = this.history.slice(windowStart);

    // 2. Repetition Guard: Check if 5 identical action hashes occur within sliding window
    if (!isStatusPolling) {
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

    // 3. Ping-Pong Guard: Check 3 consecutive alternating action pairs (A-B-A-B-A-B)
    const requiredPingPongLength = this.pingPongThreshold * 2;
    if (this.history.length >= requiredPingPongLength) {
      const pingPongSlice = this.history.slice(-requiredPingPongLength);
      const hasStatusPolling = pingPongSlice.some(
        (item) =>
          item.toolName === 'manage_task' &&
          (item.args?.Action === 'status' ||
            item.args?.action === 'status' ||
            item.args?.Action === 'list' ||
            item.args?.action === 'list')
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

  /**
   * Feeds a single line of output (stream-json or raw text) into the guard.
   */
  public feedLine(line: string): LoopGuardTrip | null {
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
    } catch {
      // Non-JSON line: ignore safely
    }

    return null;
  }

  private triggerTrip(trip: LoopGuardTrip): LoopGuardTrip {
    this.trippedResult = trip;
    if (this.onTrip) {
      try {
        this.onTrip(trip);
      } catch {
        // Safe callback handling
      }
    }
    return trip;
  }
}

export interface LoopGuardFailureCardOptions {
  routine: string;
  trip: LoopGuardTrip;
  runId?: string;
  serverUrl?: string;
  repository?: string;
}

/**
 * Formats a structured 5-point milestone interruption card on circuit breaker trip.
 */
export function formatLoopGuardFailureCard(options: LoopGuardFailureCardOptions): string {
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

export interface LoopGuardReportOptions {
  routine: string;
  timestamp: string;
  trip: LoopGuardTrip;
}

/**
 * Formats a markdown run report for .jonah-fleet/run-report.md when loop guard terminates a run.
 */
export function formatLoopGuardReport(options: LoopGuardReportOptions): string {
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
