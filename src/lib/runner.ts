import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { createWorktree, removeWorktree } from './worktree.js';
import {
  TerminalSpinner,
  detectActivePhase,
  detectClaimedIssue,
  detectClaimedPR,
  formatActionDescription,
  cleanTargetTitle,
  formatTargetLabel,
  fetchTargetTitleAsync,
  renderSummaryCard,
  renderErrorCard,
} from './terminal-card.js';
import pc from 'picocolors';

export interface RunLocalRoutineOptions {
  targetDir: string;
  routine: string;
  issue?: string | number;
  pr?: string | number;
  title?: string;
  model?: string;
  printTimeout?: string;
  noWorktree?: boolean;
  keepWorktree?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  showCard?: boolean;
  env?: Record<string, string>;
  onLog?: (chunk: string) => void;
  onTargetDetected?: (target: string) => void;
}

export interface RunLocalRoutineResult {
  success: boolean;
  exitCode: number;
  output: string;
  worktreePath?: string;
  branchName?: string;
  issueNumber?: number;
}

export interface StreamJsonEvent {
  event?: string;
  conversation_id?: string;
  init?: {
    cwd?: string;
    tools?: string[];
    permission_mode?: string;
  };
  step_update?: {
    conversation_id?: string;
    step_index?: number;
    state?: 'ACTIVE' | 'DONE' | 'ERROR' | string;
    step_type?: 'user_input' | 'agent_response' | 'tool' | 'thought' | string;
    tool_name?: string;
    tool_info?: {
      name?: string;
      parameters?: Record<string, any>;
      output?: string;
    };
    text_delta?: string;
    duration_seconds?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      total_tokens?: number;
    };
  };
  agent_response?: any;
  result?: {
    conversation_id?: string;
    status?: string;
    response?: string;
    duration_seconds?: number;
    num_turns?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      total_tokens?: number;
    };
  };
  [key: string]: any;
}

/**
 * Line buffer for incremental stream-json chunk processing.
 */
export class LineBufferedStreamParser {
  private buffer = '';
  private onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  public feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.onLine(trimmed);
      }
    }
  }

  public flush(): void {
    if (this.buffer.trim().length > 0) {
      this.onLine(this.buffer.trim());
      this.buffer = '';
    }
  }
}

/**
 * Safely parses a JSON event line from stream-json output.
 */
export function parseStreamJsonEvent(line: string): StreamJsonEvent | null {
  if (!line || !line.trim()) return null;
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object') {
      return parsed as StreamJsonEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Formats stream-json events for verbose output.
 */
export function formatVerboseEvent(event: StreamJsonEvent): string | null {
  const time = new Date().toLocaleTimeString();

  if (event.event === 'init') {
    return `${pc.dim(`[${time}]`)} ${pc.cyan('[init]')} Session started (conversation: ${event.conversation_id || 'n/a'})`;
  }

  if (event.event === 'step_update' && event.step_update) {
    const su = event.step_update;

    if (su.step_type === 'user_input') {
      return `${pc.dim(`[${time}]`)} ${pc.magenta('[user_input]')} Prompt dispatched`;
    }

    if (su.step_type === 'tool') {
      const toolName = su.tool_name || su.tool_info?.name || 'tool';
      const params = su.tool_info?.parameters;

      if (su.state === 'ACTIVE') {
        const desc = formatActionDescription(toolName, params);
        return `${pc.dim(`[${time}]`)} ${pc.blue('[tool:start]')} ${pc.bold(toolName)} → ${desc}`;
      }
      if (su.state === 'DONE') {
        const dur = su.duration_seconds !== undefined ? `${su.duration_seconds.toFixed(1)}s` : 'done';
        return `${pc.dim(`[${time}]`)} ${pc.green('[tool:done]')} ${pc.bold(toolName)} (${dur})`;
      }
    }

    if (su.step_type === 'agent_response' || su.step_type === 'thought') {
      if (su.text_delta) {
        return su.text_delta;
      }
      if (su.state === 'DONE') {
        const dur = su.duration_seconds !== undefined ? ` (${su.duration_seconds.toFixed(1)}s)` : '';
        return `${pc.dim(`[${time}]`)} ${pc.cyan('[agent:step]')} Step ${su.step_index ?? 0} finished${dur}`;
      }
    }
  }

  if (event.event === 'result' && event.result) {
    const res = event.result;
    const dur = res.duration_seconds !== undefined ? `${res.duration_seconds.toFixed(1)}s` : '';
    const tokens = res.usage?.total_tokens ? `${res.usage.total_tokens.toLocaleString()} tokens` : '';
    const metrics = [dur, tokens].filter(Boolean).join(', ');
    return `${pc.dim(`[${time}]`)} ${pc.bold(pc.green('[result]'))} ${res.status || 'COMPLETED'} (${metrics || 'done'})`;
  }

  return null;
}

/**
 * Builds the invocation arguments for Antigravity CLI in stream-json mode.
 */
export function buildAgyArgs(prompt: string, model: string, printTimeout: string): string[] {
  return [
    '-p',
    prompt,
    '--model',
    model,
    '--output-format',
    'stream-json',
    '--print-timeout',
    printTimeout,
    '--dangerously-skip-permissions',
  ];
}

/**
 * Discovers domain skills in .agents/skills and formats instruction string.
 */
export function discoverSkillsPrompt(targetDir: string): string {
  const skillsDir = path.join(targetDir, '.agents', 'skills');
  if (!fs.existsSync(skillsDir)) return '';

  let skillsPrompt = '';
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join('.agents', 'skills', entry.name, 'SKILL.md');
        const fullPath = path.join(targetDir, skillPath);
        if (fs.existsSync(fullPath)) {
          skillsPrompt += `Read and follow ${skillPath}. `;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return skillsPrompt;
}

/**
 * Builds the prompt string for a given routine and target.
 */
export function buildRoutinePrompt(
  targetDir: string,
  routine: string,
  options: { issue?: string | number; pr?: string | number; routineIssueNumber?: number } = {}
): string {
  const skillsPrompt = discoverSkillsPrompt(targetDir);
  const promptFile = `.github/prompts/${routine}.md`;
  const logPrompt = options.routineIssueNumber
    ? ` Tracking run log issue: #${options.routineIssueNumber}.`
    : '';

  if (routine === 'autowork') {
    if (options.issue) {
      return `You are the Autowork routine for this repository. Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}Your target is issue #${options.issue}. You are in Targeted mode: work issue #${options.issue} directly, ahead of Phase 1 convergence and priority scan.${logPrompt}`;
    }
    return `You are the Autowork routine for this repository. Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}You are in Scan mode: check open PRs for review comments to fix, close merged issues, then pick the highest-priority unclaimed issue.${logPrompt}`;
  }

  if (routine === 'peer-review') {
    if (options.pr) {
      return `You are the Peer Review routine for this repository. Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}Your target is pull request #${options.pr}. You are in Targeted mode: review PR #${options.pr} directly.${logPrompt}`;
    }
    return `You are the Peer Review routine for this repository. Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}You are in Scan mode: check open PRs and select the highest-priority PR to review.${logPrompt}`;
  }

  return `You are the ${routine} routine for this repository. Read and follow the instructions in ${promptFile} exactly. ${skillsPrompt}${logPrompt}`;
}

/**
 * Checks if Antigravity CLI (`agy`) is installed and accessible.
 */
export function isAgyInstalled(): boolean {
  try {
    execSync('agy --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempts to initialize a GitHub issue for local routine execution (runner:local).
 * Fails gracefully if offline or unauthenticated.
 */
export function tryCreateLocalRunIssue(
  cwd: string,
  routine: string,
  timestamp: string,
  targetLabel: string,
  hostname: string
): number | undefined {
  try {
    const title = `[${routine}] run ${timestamp} (local)`;
    const body = `### Autonomous Routine Execution in Progress (runner:local)\n- **Routine**: \`${routine}\`\n- **Timestamp**: \`${timestamp}\`\n- **Target**: \`${targetLabel}\`\n- **Host**: \`${hostname}\`\n\n_Running via Jonah Fleet CLI runner._`;
    const labels = `routine-log,routine:${routine},status:running,runner:local`;
    const out = execSync(`gh issue create --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label ${JSON.stringify(labels)}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = out.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconciles a GitHub issue for local routine execution.
 * Closes the issue if success, leaves it open with needs-attention if failure.
 * Fails gracefully if offline or unauthenticated.
 */
export function tryReconcileLocalRunIssue(
  cwd: string,
  issueNumber: number,
  reportContent: string,
  exitCode: number,
  hostname: string
): void {
  try {
    const finalBody = `${reportContent}\n\n---\n_Generated by Jonah Fleet local runner on ${hostname}._`;
    const tmpFile = path.join(os.tmpdir(), `jonah-fleet-run-${issueNumber}-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, finalBody, 'utf8');
    try {
      execSync(`gh issue edit ${issueNumber} --body-file ${JSON.stringify(tmpFile)}`, {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      if (exitCode === 0) {
        execSync(`gh issue edit ${issueNumber} --add-label "status:success" --remove-label "status:running"`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        execSync(`gh issue close ${issueNumber} --reason completed`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } else {
        execSync(`gh issue edit ${issueNumber} --add-label "status:failure,needs-attention" --remove-label "status:running"`, {
          cwd,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      }
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  } catch {
    // Ignore offline or auth failures during issue reconciliation
  }
}

/**
 * Runs a routine locally with worktree isolation and Antigravity CLI invocation.
 */
export async function runLocalRoutine(options: RunLocalRoutineOptions): Promise<RunLocalRoutineResult> {
  const targetDir = path.resolve(options.targetDir);
  const routine = options.routine;
  const model = options.model || 'gemini-3.7-flash-high';
  const printTimeout = options.printTimeout || '30m';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const hostname = os.hostname();

  // Validate prompt file existence
  const promptFile = path.join(targetDir, '.github', 'prompts', `${routine}.md`);
  if (!fs.existsSync(promptFile)) {
    throw new Error(`Routine prompt file not found: ${promptFile}`);
  }

  // Generate branch name
  let branchName = `agent/${routine}-${timestamp}`;
  if (options.issue) {
    branchName = `agent/${routine}-issue-${options.issue}-${timestamp}`;
  } else if (options.pr) {
    branchName = `agent/${routine}-pr-${options.pr}-${timestamp}`;
  }

  let worktreePath: string | undefined;
  let executionDir = targetDir;

  if (!options.noWorktree && !options.dryRun) {
    const worktreeResult = await createWorktree(targetDir, { branchName });
    worktreePath = worktreeResult.worktreePath;
    executionDir = worktreePath;
  }

  let targetTitle: string | undefined = options.title;
  const baseTarget = options.pr
    ? `PR #${options.pr}`
    : options.issue
      ? `Issue #${options.issue}`
      : undefined;

  let targetLabel = baseTarget
    ? formatTargetLabel(baseTarget, targetTitle)
    : routine;
  let dynamicTargetDetected = Boolean(options.pr || options.issue);

  let routineIssueNumber: number | undefined;
  if (!options.dryRun) {
    routineIssueNumber = tryCreateLocalRunIssue(targetDir, routine, timestamp, targetLabel, hostname);
  }

  const prompt = buildRoutinePrompt(executionDir, routine, {
    issue: options.issue,
    pr: options.pr,
    routineIssueNumber,
  });

  if (options.dryRun) {
    return {
      success: true,
      exitCode: 0,
      output: `[DRY RUN] Would execute routine '${routine}' in ${options.noWorktree ? 'current directory' : 'worktree'}:\nPrompt: ${prompt}\nModel: ${model}\nTimeout: ${printTimeout}`,
      worktreePath,
      branchName,
    };
  }

  // Prepare environment
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    LOCAL_AGENT: 'true',
    LOCAL_HOST: hostname,
    TARGET_ISSUE: options.issue ? String(options.issue) : '',
    PR_NUMBER: options.pr ? String(options.pr) : '',
  };

  if (routineIssueNumber) {
    childEnv.ROUTINE_ISSUE_NUMBER = String(routineIssueNumber);
  }

  const args = buildAgyArgs(prompt, model, printTimeout);

  let output = '';
  let finalResponseText = '';
  let accumulatedOutput = '';
  let exitCode = 0;
  const startTime = Date.now();

  const logDir = path.join(targetDir, '.jonah-fleet');
  fs.mkdirSync(logDir, { recursive: true });
  const logFilePath = path.join(logDir, 'daemon.log');
  const runsDir = path.join(logDir, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  let activePhase = 'Starting session...';
  let lastActionDesc: string | null = null;
  const spinner = !options.verbose ? new TerminalSpinner() : null;
  if (spinner) {
    spinner.start(`${targetLabel}: ${activePhase}`);
  }

  // If target was supplied via options but without a title, fetch title in background
  if (baseTarget && !targetTitle) {
    fetchTargetTitleAsync(targetDir, baseTarget)
      .then((fetchedTitle) => {
        if (fetchedTitle && !targetTitle) {
          targetTitle = fetchedTitle;
          targetLabel = formatTargetLabel(baseTarget, targetTitle);
          options.onTargetDetected?.(targetLabel);
          if (spinner) {
            spinner.update(`${targetLabel}: ${lastActionDesc || activePhase}`);
          }
        }
      })
      .catch(() => {});
  }

  // Cleanup handler on process interruption
  const cleanup = async () => {
    spinner?.stop();
    if (worktreePath && !options.keepWorktree) {
      await removeWorktree(targetDir, worktreePath, { deleteBranch: false }).catch(() => {});
    }
  };

  const sigintHandler = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigintHandler);

  const checkTargetDetection = (text: string) => {
    if (dynamicTargetDetected || !text) return;
    const detected =
      routine === 'peer-review' ? detectClaimedPR(text) : detectClaimedIssue(text);
    if (detected) {
      dynamicTargetDetected = true;
      targetLabel = detected;
      options.onTargetDetected?.(detected);
      if (spinner) {
        spinner.update(`${targetLabel}: ${lastActionDesc || activePhase}`);
      }

      fetchTargetTitleAsync(executionDir, detected)
        .then((fetchedTitle) => {
          if (fetchedTitle) {
            targetTitle = fetchedTitle;
            targetLabel = formatTargetLabel(detected, fetchedTitle);
            options.onTargetDetected?.(targetLabel);
            if (spinner) {
              spinner.update(`${targetLabel}: ${lastActionDesc || activePhase}`);
            }
          }
        })
        .catch(() => {});
    }
  };

  const stdoutParser = new LineBufferedStreamParser((line: string) => {
    const event = parseStreamJsonEvent(line);
    if (event) {
      if (event.event === 'step_update' && event.step_update) {
        const su = event.step_update;

        if (su.step_type === 'tool') {
          const toolName = su.tool_name || su.tool_info?.name || 'unknown';
          const toolParams = su.tool_info?.parameters;

          if (su.state === 'ACTIVE') {
            const actionDesc = formatActionDescription(toolName, toolParams);
            lastActionDesc = actionDesc;
            if (spinner) {
              spinner.update(`${targetLabel}: ${actionDesc}`);
            }
            if (toolParams?.CommandLine) {
              checkTargetDetection(toolParams.CommandLine);
            }
            if (options.verbose) {
              const formatted = formatVerboseEvent(event);
              if (formatted) console.log(formatted);
            }
          } else if (su.state === 'DONE') {
            lastActionDesc = null;
            if (su.tool_info?.output) {
              checkTargetDetection(su.tool_info.output);
            }
            if (spinner) {
              activePhase = 'Evaluating tool output...';
              spinner.update(`${targetLabel}: ${activePhase}`);
            }
            if (options.verbose) {
              const formatted = formatVerboseEvent(event);
              if (formatted) console.log(formatted);
            }
          }
        } else if (su.step_type === 'agent_response' || su.step_type === 'thought') {
          if (su.text_delta) {
            accumulatedOutput += su.text_delta;
            checkTargetDetection(su.text_delta);
            const newPhase = detectActivePhase(su.text_delta, activePhase);
            if (newPhase !== activePhase || lastActionDesc) {
              lastActionDesc = null;
              activePhase = newPhase;
              if (spinner) {
                spinner.update(`${targetLabel}: ${activePhase}`);
              }
            }
            if (options.verbose) {
              process.stdout.write(su.text_delta);
            }
          } else if (options.verbose && su.state === 'DONE') {
            const formatted = formatVerboseEvent(event);
            if (formatted) console.log(formatted);
          }
        } else if (options.verbose) {
          const formatted = formatVerboseEvent(event);
          if (formatted) console.log(formatted);
        }
      } else if (event.event === 'result' && event.result) {
        if (event.result.response) {
          finalResponseText = event.result.response;
          checkTargetDetection(event.result.response);
        }
        if (options.verbose) {
          const formatted = formatVerboseEvent(event);
          if (formatted) console.log(formatted);
        }
      } else if (event.event === 'init') {
        if (options.verbose) {
          const formatted = formatVerboseEvent(event);
          if (formatted) console.log(formatted);
        }
      }
    } else {
      // Non-JSON line from stdout
      accumulatedOutput += line + '\n';
      checkTargetDetection(line);
      if (options.verbose) {
        console.log(line);
      } else if (spinner) {
        lastActionDesc = null;
        const newPhase = detectActivePhase(line, activePhase);
        if (newPhase !== activePhase) {
          activePhase = newPhase;
          spinner.update(`${targetLabel}: ${activePhase}`);
        }
      }
    }
  });

  const stderrParser = new LineBufferedStreamParser((line: string) => {
    checkTargetDetection(line);
    if (options.verbose) {
      console.error(pc.dim(`[stderr] ${line}`));
    } else if (spinner) {
      lastActionDesc = null;
      const newPhase = detectActivePhase(line, activePhase);
      if (newPhase !== activePhase) {
        activePhase = newPhase;
        spinner.update(`${targetLabel}: ${activePhase}`);
      }
    }
  });

  const processChunk = (chunk: string, isStderr: boolean = false) => {
    try {
      fs.appendFileSync(logFilePath, chunk, 'utf8');
    } catch {
      // Ignore log write errors
    }

    if (options.onLog) {
      options.onLog(chunk);
    }

    if (isStderr) {
      stderrParser.feed(chunk);
    } else {
      stdoutParser.feed(chunk);
    }
  };

  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('agy', args, {
        cwd: executionDir,
        env: childEnv,
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (data) => {
        processChunk(data.toString(), false);
      });

      child.stderr?.on('data', (data) => {
        processChunk(data.toString(), true);
      });

      child.on('error', (err) => {
        spinner?.stop();
        reject(err);
      });

      child.on('close', (code) => {
        spinner?.stop();
        resolve(code ?? 0);
      });
    });
  } finally {
    spinner?.stop();
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('SIGTERM', sigintHandler);
    if (!options.keepWorktree) {
      await cleanup();
    }
  }

  stdoutParser.flush();
  stderrParser.flush();
  output = finalResponseText || accumulatedOutput;

  const durationMs = Date.now() - startTime;
  const durationSec = Math.round(durationMs / 1000);

  // Check for .jonah-fleet/run-report.md (in executionDir or targetDir)
  const executionReportPath = path.join(executionDir, '.jonah-fleet', 'run-report.md');
  const targetReportPath = path.join(targetDir, '.jonah-fleet', 'run-report.md');

  let reportContent = '';
  if (fs.existsSync(executionReportPath)) {
    try {
      reportContent = fs.readFileSync(executionReportPath, 'utf8');
    } catch {}
  } else if (fs.existsSync(targetReportPath)) {
    try {
      reportContent = fs.readFileSync(targetReportPath, 'utf8');
    } catch {}
  }

  if (!reportContent) {
    reportContent = `## Run Summary\n\n| Metric | Value |\n|---|---|\n| Routine | \`${routine}\` |\n| Timestamp | \`${timestamp}\` |\n| Result | \`${exitCode === 0 ? 'SUCCESS' : 'FAILURE'}\` |\n| Exit Code | \`${exitCode}\` |\n| Host | \`${hostname}\` |\n| Target | \`${targetLabel}\` |\n| Duration | \`${durationSec}s\` |\n`;
  }

  // Ensure report is copied to targetDir/.jonah-fleet/run-report.md
  try {
    fs.writeFileSync(targetReportPath, reportContent, 'utf8');
  } catch {}

  // Save run history to .jonah-fleet/runs/
  const runReportFile = path.join(runsDir, `${routine}-${timestamp}.md`);
  const runMetaFile = path.join(runsDir, `${routine}-${timestamp}.json`);
  try {
    fs.writeFileSync(runReportFile, reportContent, 'utf8');
    fs.writeFileSync(
      runMetaFile,
      JSON.stringify(
        {
          routine,
          timestamp,
          exitCode,
          success: exitCode === 0,
          target: targetLabel,
          issueNumber: routineIssueNumber,
          durationMs,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {}

  // Reconcile GitHub issue if one was created
  if (routineIssueNumber) {
    tryReconcileLocalRunIssue(targetDir, routineIssueNumber, reportContent, exitCode, hostname);
  }

  // Render Card if not in verbose mode and showCard is not disabled
  if (options.showCard !== false && !options.verbose) {
    const prMatch = targetLabel.match(/PR\s*#?(\d+)/i);
    const issueMatch = targetLabel.match(/Issue\s*#?(\d+)/i);
    const effectiveIssue =
      options.issue || (issueMatch ? issueMatch[1] : undefined);
    const effectivePR =
      options.pr || (prMatch ? prMatch[1] : undefined);

    if (exitCode === 0) {
      console.log(
        '\n' +
          renderSummaryCard({
            routine,
            output,
            repoRoot: targetDir,
            issue: effectiveIssue,
            pr: effectivePR,
            title: targetTitle,
            durationMs,
          }) +
          '\n'
      );
    } else {
      console.log(
        '\n' +
          renderErrorCard({
            routine,
            exitCode,
            repoRoot: targetDir,
            issue: effectiveIssue,
            pr: effectivePR,
            durationMs,
          }) +
          '\n'
      );
    }
  }

  return {
    success: exitCode === 0,
    exitCode,
    output,
    worktreePath,
    branchName,
    issueNumber: routineIssueNumber,
  };
}
