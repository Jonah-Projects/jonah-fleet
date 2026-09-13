import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import {
  parseLogToTelemetry,
  aggregateFleetTelemetry,
  emitTelemetry,
  renderTelemetryDashboard,
  collectLocalTelemetryLogs,
  collectRepoTelemetry,
  RoutineTelemetrySummary,
  GLOBAL_WEEKLY_TOKEN_BUDGET,
} from '../lib/telemetry.js';
import { loadManifest } from '../lib/manifest.js';
import { getFleetRepositories } from '../lib/global-config.js';
import { defaultGhExecutor, GhExecutor } from '../lib/fleet-query.js';

export interface TelemetryOptions {
  action?: 'emit' | 'aggregate' | 'status';
  log?: string;
  endpoint?: string;
  repo?: string;
  repos?: string[];
  budget?: string | number;
  json?: boolean;
  cwd?: string;
  executor?: GhExecutor;
}

export async function runTelemetry(options: TelemetryOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const executor = options.executor || defaultGhExecutor;
  const manifest = loadManifest(cwd);

  const weeklyBudget =
    typeof options.budget === 'number'
      ? options.budget
      : typeof options.budget === 'string'
      ? parseInt(options.budget, 10)
      : manifest?.telemetry?.weeklyTokenBudget || GLOBAL_WEEKLY_TOKEN_BUDGET;

  // 1. Action: emit
  if (options.action === 'emit' || options.log) {
    let logPath = options.log;
    if (!logPath) {
      // Find latest log in .jonah-fleet/run-report.md, .jonah-fleet/runs, or legacy .github/prompts/logs
      const reportFile = path.join(cwd, '.jonah-fleet/run-report.md');
      if (fs.existsSync(reportFile)) {
        logPath = reportFile;
      } else {
        const runsDir = path.join(cwd, '.jonah-fleet/runs');
        const legacyLogsDir = path.join(cwd, '.github/prompts/logs');
        let latestFile: string | null = null;
        let latestMtime = 0;
        const findLogs = (dir: string) => {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) findLogs(p);
            else if (entry.isFile() && entry.name.endsWith('.md')) {
              const stat = fs.statSync(p);
              if (stat.mtimeMs > latestMtime) {
                latestMtime = stat.mtimeMs;
                latestFile = p;
              }
            }
          }
        };
        findLogs(runsDir);
        findLogs(legacyLogsDir);
        logPath = latestFile || undefined;
      }
    }

    if (!logPath || !fs.existsSync(logPath)) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No log file found to emit', path: logPath }, null, 2));
      } else {
        console.log(pc.yellow(`\n⚠️  No log file found to emit: ${logPath || 'none specified'}\n`));
      }
      return;
    }

    const content = fs.readFileSync(logPath, 'utf8');
    const repoName = options.repo || process.env.GITHUB_REPOSITORY || (manifest ? 'local' : 'unknown');
    const runId = process.env.GITHUB_RUN_ID;
    const runNumber = process.env.GITHUB_RUN_NUMBER ? parseInt(process.env.GITHUB_RUN_NUMBER, 10) : undefined;

    const summary = parseLogToTelemetry(content, {
      repository: repoName,
      runId,
      runNumber,
    });

    if (!summary) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'Failed to parse metadata from log file', path: logPath }, null, 2));
      } else {
        console.log(pc.red(`\n❌ Failed to parse valid telemetry metadata from: ${logPath}\n`));
      }
      return;
    }

    const endpoint =
      options.endpoint ||
      process.env.JONAH_FLEET_TELEMETRY_ENDPOINT ||
      process.env.TELEMETRY_ENDPOINT ||
      manifest?.telemetry?.endpoint;

    const emitResult = await emitTelemetry(summary, endpoint);

    if (options.json) {
      console.log(JSON.stringify({ success: emitResult.success, error: emitResult.error, summary }, null, 2));
    } else {
      if (emitResult.success) {
        if (endpoint) {
          console.log(pc.green(`✓ Successfully emitted telemetry summary for ${pc.bold(summary.routine)} to ${endpoint}`));
        } else {
          console.log(pc.gray(`ℹ Telemetry summary parsed for ${summary.routine} (emission skipped: no endpoint configured)`));
        }
      } else {
        console.log(pc.red(`❌ Failed to emit telemetry to ${endpoint}: ${emitResult.error}`));
      }
    }
    return;
  }

  // 2. Action: aggregate / dashboard
  let targetRepos: string[] = [];
  if (options.repos && options.repos.length > 0) {
    targetRepos = options.repos;
  } else {
    targetRepos = getFleetRepositories(cwd);
  }

  const allSummaries: RoutineTelemetrySummary[] = [];

  // Local repo logs
  const localSummaries = collectLocalTelemetryLogs(cwd, process.env.GITHUB_REPOSITORY || 'local');
  allSummaries.push(...localSummaries);

  // External / configured repositories
  for (const repo of targetRepos) {
    if (repo === 'local' || repo === cwd) continue;
    try {
      const repoSummaries = await collectRepoTelemetry(repo, executor);
      allSummaries.push(...repoSummaries);
    } catch {}
  }

  const aggregated = aggregateFleetTelemetry(allSummaries, { weeklyTokenBudget: weeklyBudget });
  const output = renderTelemetryDashboard(aggregated, { json: options.json });
  console.log(output);
}
