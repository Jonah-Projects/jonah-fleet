import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { loadManifest } from '../lib/manifest.js';
import { checkDrift } from '../lib/diff.js';
import { FLEET_VERSION } from '../lib/presets.js';
import { computeTokenSpendFromLogs } from '../lib/fleet-query.js';
import { formatTokens, formatCurrency } from '../lib/dashboard.js';
import { runMonitor } from './monitor.js';
import { renderFleetBanner } from '../lib/brand.js';

export interface StatusOptions {
  cwd?: string;
  fleet?: boolean;
  json?: boolean;
  tokens?: boolean;
  detailed?: boolean;
}

export async function runStatus(options: StatusOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();

  if (options.fleet) {
    await runMonitor({ cwd, json: options.json, tokens: options.tokens, detailed: options.detailed });
    return;
  }

  const manifest = loadManifest(cwd);

  if (!manifest) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No agents-manifest.json found', cwd }, null, 2));
      return;
    }
    console.log(pc.yellow(`\n⚠️  No agents-manifest.json found in ${cwd}. This project is not configured with Jonah Fleet.`));
    console.log(pc.cyan(`Run 'npx jonah-fleet init' to set up autonomous agent routines.\n`));
    return;
  }

  const drift = checkDrift(cwd, manifest);
  const hasDrift =
    drift.missingPrompts.length > 0 ||
    drift.modifiedPrompts.length > 0 ||
    drift.missingWorkflows.length > 0 ||
    drift.modifiedWorkflows.length > 0 ||
    drift.missingSkills.length > 0;

  const runsDir = path.join(cwd, '.jonah-fleet/runs');
  const legacyLogsDir = path.join(cwd, '.github/prompts/logs');
  let tokenUsage = undefined;
  const logContents: string[] = [];
  const collectLogs = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectLogs(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          logContents.push(fs.readFileSync(fullPath, 'utf8'));
        } catch {}
      }
    }
  };
  collectLogs(runsDir);
  collectLogs(legacyLogsDir);

  if (logContents.length > 0) {
    tokenUsage = computeTokenSpendFromLogs(logContents);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          cwd,
          version: manifest.version,
          fleetLatestVersion: FLEET_VERSION,
          preset: manifest.preset,
          autoUpdate: manifest.autoUpdate,
          routines: manifest.routines,
          skills: manifest.skills,
          models: manifest.models,
          budgets: manifest.budgets,
          repositories: manifest.repositories || [],
          tokenUsage,
          drift: {
            hasDrift,
            ...drift,
          },
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    renderFleetBanner({
      command: 'STATUS',
      subtitle: 'TELEMETRY & DRIFT AUDIT',
      details: [
        { label: 'Version', value: manifest.version },
        { label: 'Preset', value: manifest.preset },
        { label: 'Target', value: cwd },
      ],
    })
  );
  console.log(pc.bold(pc.cyan(`\n📊 Jonah Fleet Status for ${cwd}\n`)));
  console.log(`  Version:         ${manifest.version === FLEET_VERSION ? pc.green(manifest.version) : pc.yellow(`${manifest.version} (fleet latest: ${FLEET_VERSION})`)}`);
  console.log(`  Preset:          ${pc.bold(manifest.preset)}`);
  console.log(`  Auto-Update:     ${manifest.autoUpdate?.enabled ? pc.green('Enabled (' + manifest.autoUpdate.channel + ')') : pc.gray('Disabled')}`);

  console.log(pc.bold('\n  Enabled Routines:'));
  for (const [routine, enabled] of Object.entries(manifest.routines)) {
    console.log(`    - ${routine.padEnd(35)}: ${enabled ? pc.green('ENABLED') : pc.gray('DISABLED')}`);
  }

  console.log(pc.bold('\n  Configured Skills:'));
  for (const skill of manifest.skills) {
    console.log(`    - ${pc.cyan(skill)}`);
  }

  if (manifest.models && Object.keys(manifest.models).length > 0) {
    console.log(pc.bold('\n  Model Profiles:'));
    for (const [routine, model] of Object.entries(manifest.models)) {
      if (model) {
        console.log(`    - ${routine.padEnd(35)}: ${pc.cyan(model)}`);
      }
    }
  }

  if (manifest.budgets) {
    console.log(pc.bold('\n  Configured Budgets:'));
    if (manifest.budgets.weeklyTokens) {
      console.log(`    - Weekly Token Budget: ${pc.cyan(formatTokens(manifest.budgets.weeklyTokens))}`);
    }
    if (manifest.budgets.timeoutMinutes && Object.keys(manifest.budgets.timeoutMinutes).length > 0) {
      console.log(`    - Timeouts:`);
      for (const [routine, timeout] of Object.entries(manifest.budgets.timeoutMinutes)) {
        if (timeout !== undefined) {
          console.log(`        • ${routine}: ${pc.cyan(timeout + 'm')}`);
        }
      }
    }
    if (manifest.budgets.maxIterations && Object.keys(manifest.budgets.maxIterations).length > 0) {
      console.log(`    - Max Iterations:`);
      for (const [routine, iter] of Object.entries(manifest.budgets.maxIterations)) {
        if (iter !== undefined) {
          console.log(`        • ${routine}: ${pc.cyan(String(iter))}`);
        }
      }
    }
  }

  if (manifest.repositories && manifest.repositories.length > 0) {
    console.log(pc.bold('\n  Fleet Repositories:'));
    for (const repo of manifest.repositories) {
      console.log(`    - ${pc.cyan(repo)}`);
    }
  }

  if (tokenUsage && tokenUsage.recentRunCount > 0) {
    console.log(pc.bold('\n  📈 7-Day Token Spend:'));
    console.log(
      `    Runs: ${pc.bold(tokenUsage.recentRunCount.toString())} | ` +
        `Tokens: ${pc.bold(formatTokens(tokenUsage.sevenDayTotalTokens))} ` +
        pc.gray(`(in: ${formatTokens(tokenUsage.sevenDayInputTokens)}, out: ${formatTokens(tokenUsage.sevenDayOutputTokens)})`) +
        ` | Cost: ${pc.bold(pc.green(formatCurrency(tokenUsage.sevenDayEstimatedCost)))}`
    );

    if (tokenUsage.byRoutine && Object.keys(tokenUsage.byRoutine).length > 0) {
      const routines = Object.values(tokenUsage.byRoutine).sort((a, b) => b.totalTokens - a.totalTokens);
      for (const r of routines) {
        const iterStr = r.avgIterationsUsed !== undefined ? `, avg ${r.avgIterationsUsed} iters` : '';
        const tokenDetails =
          options.tokens || options.detailed
            ? ` (in: ${formatTokens(r.inputTokens)}, out: ${formatTokens(r.outputTokens)})`
            : '';
        console.log(
          `      • ${pc.bold(r.routine)}: ${pc.cyan(formatTokens(r.totalTokens))} tokens${pc.gray(tokenDetails)} ` +
            pc.gray(`(${r.fleetSharePercent.toFixed(1)}%)`) +
            ` | Cost: ${pc.green(formatCurrency(r.estimatedCost))} | ` +
            `${r.runCount} run${r.runCount === 1 ? '' : 's'}${pc.gray(iterStr)}`
        );
      }
    }
  }

  console.log(pc.bold('\n  Drift / Health:'));
  if (!hasDrift) {
    console.log(pc.green('    ✓ All prompts, workflows, and skills are healthy and match fleet templates.\n'));
  } else {
    if (drift.missingPrompts.length > 0) console.log(pc.red(`    ❌ Missing prompts: ${drift.missingPrompts.join(', ')}`));
    if (drift.modifiedPrompts.length > 0) console.log(pc.yellow(`    ⚠️  Modified prompts: ${drift.modifiedPrompts.join(', ')}`));
    if (drift.missingWorkflows.length > 0) console.log(pc.red(`    ❌ Missing workflows: ${drift.missingWorkflows.join(', ')}`));
    if (drift.modifiedWorkflows.length > 0) console.log(pc.yellow(`    ⚠️  Modified workflows: ${drift.modifiedWorkflows.join(', ')}`));
    if (drift.missingSkills.length > 0) console.log(pc.red(`    ❌ Missing skills: ${drift.missingSkills.join(', ')}`));
    console.log(pc.cyan('\n  Run \'jonah-fleet sync\' to synchronize files.\n'));
  }
}
