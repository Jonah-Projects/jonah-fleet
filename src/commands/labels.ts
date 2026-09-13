import pc from 'picocolors';
import {
  fetchRepoLabels,
  classifyLabels,
  pruneLabels,
  provisionLabels,
  resolveRepoName,
  DEFAULT_PROTECTED_LABEL_PATTERNS,
} from '../lib/labels.js';
import { loadManifest } from '../lib/manifest.js';
import { defaultGhExecutor, GhExecutor } from '../lib/fleet-query.js';

export interface LabelsCommandOptions {
  repo?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  cwd?: string;
  executor?: GhExecutor;
}

export async function runLabels(
  action: 'audit' | 'list' | 'prune' | 'provision' = 'audit',
  options: LabelsCommandOptions = {}
): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const executor = options.executor || defaultGhExecutor;
  const repo = await resolveRepoName(options.repo, cwd, executor);

  const manifest = loadManifest(cwd);
  const userProtected = manifest?.labels?.protected || [];
  const protectedPatterns = [
    ...DEFAULT_PROTECTED_LABEL_PATTERNS,
    ...userProtected,
  ];

  if (action === 'provision' || (action as string) === 'sync') {
    const result = await provisionLabels({ repo, cwd, executor });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(pc.bold(pc.cyan(`\n🏷️  Fleet Label Provisioning for ${repo}\n`)));
    if (result.created.length > 0) {
      console.log(pc.green(`  ✓ Created ${result.created.length} missing label(s):`));
      for (const label of result.created) {
        console.log(`    - ${pc.green(label)}`);
      }
    }
    if (result.alreadyExists.length > 0) {
      console.log(pc.dim(`  ℹ ${result.alreadyExists.length} label(s) already exist.`));
    }
    if (result.errors.length > 0) {
      console.log(pc.red(`\n  ❌ Failed to create ${result.errors.length} label(s):`));
      for (const err of result.errors) {
        console.log(`    - ${pc.red(err.label)}: ${err.error}`);
      }
    }
    console.log();
    return;
  }

  if (action === 'prune') {
    const isDryRun = Boolean(options.dryRun);
    const result = await pruneLabels({
      repo,
      dryRun: isDryRun,
      yes: options.yes,
      cwd,
      protectedPatterns,
      executor,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (isDryRun) {
      console.log(pc.bold(pc.cyan(`\n🔍 Label Prune (Dry-Run) for ${repo}\n`)));
      if (result.pruned.length === 0) {
        console.log(pc.green('  ✓ No prunable labels found. Repository labels are clean.\n'));
      } else {
        console.log(pc.yellow(`  Found ${result.pruned.length} strictly unused label(s) eligible for pruning:`));
        for (const label of result.pruned) {
          console.log(`    - ${pc.yellow(label)} (0 issues, 0 PRs, non-schema)`);
        }
        console.log(pc.gray(`\n  Run 'jonah-fleet labels prune --yes' to delete these labels.\n`));
      }
      return;
    }

    console.log(pc.bold(pc.cyan(`\n🧹 Label Pruning for ${repo}\n`)));
    if (result.pruned.length === 0 && result.errors.length === 0) {
      console.log(pc.green('  ✓ No prunable labels found. Repository labels are clean.\n'));
      return;
    }

    if (result.pruned.length > 0) {
      console.log(pc.green(`  ✓ Successfully pruned ${result.pruned.length} unused label(s):`));
      for (const label of result.pruned) {
        console.log(`    - ${pc.green(label)}`);
      }
    }

    if (result.errors.length > 0) {
      console.log(pc.red(`\n  ❌ Failed to delete ${result.errors.length} label(s):`));
      for (const err of result.errors) {
        console.log(`    - ${pc.red(err.label)}: ${err.error}`);
      }
    }
    console.log();
    return;
  }

  // Default: audit / list
  const rawLabels = await fetchRepoLabels(repo, executor, cwd);
  const classified = classifyLabels(rawLabels, protectedPatterns);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          repo,
          totalCount: rawLabels.length,
          activeCount: classified.active.length,
          protectedZeroCountCount: classified.protectedZeroCount.length,
          historicalCount: classified.historical.length,
          prunableCount: classified.prunable.length,
          active: classified.active,
          protectedZeroCount: classified.protectedZeroCount,
          historical: classified.historical,
          prunable: classified.prunable,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(pc.bold(pc.cyan(`\n🏷️  Repository Label Audit for ${repo}\n`)));
  console.log(`  Total Labels:            ${pc.bold(String(rawLabels.length))}`);
  console.log(`  Active (Open items):     ${pc.green(String(classified.active.length))}`);
  console.log(`  Protected (Zero-count):  ${pc.cyan(String(classified.protectedZeroCount.length))}`);
  console.log(`  Historical (Closed):     ${pc.gray(String(classified.historical.length))}`);
  console.log(`  Prunable (Unused):       ${classified.prunable.length > 0 ? pc.yellow(String(classified.prunable.length)) : pc.green('0')}`);

  if (classified.prunable.length > 0) {
    console.log(pc.bold(pc.yellow('\n  ⚠️  Prunable Labels (0 total issues/PRs, non-protected):')));
    for (const label of classified.prunable) {
      console.log(`    - ${pc.yellow(label.name)}`);
    }
    console.log(pc.gray(`\n  Run 'jonah-fleet labels prune' to clean up unused boilerplate.\n`));
  } else {
    console.log(pc.green('\n  ✓ All labels are either active, historical, or protected fleet taxonomy.\n'));
  }
}
