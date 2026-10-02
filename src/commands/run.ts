import path from 'node:path';
import pc from 'picocolors';
import { runLocalRoutine } from '../lib/runner.js';
import { loadManifest } from '../lib/manifest.js';
import { detectPeerReviewOutcome, formatPeerReviewOutcomeMessage } from '../lib/terminal-card.js';

export interface RunCommandOptions {
  issue?: string;
  pr?: string;
  model?: string;
  timeout?: string;
  worktree?: boolean;
  keepWorktree?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function runRoutineCommand(routine: string, options: RunCommandOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const manifest = loadManifest(cwd);

  if (!manifest) {
    console.warn(
      pc.yellow(`⚠️  No agents-manifest.json found in ${cwd}. Running in unmanaged repository mode.`)
    );
  } else if (manifest.routines && manifest.routines[routine as keyof typeof manifest.routines] === false) {
    console.warn(
      pc.yellow(`⚠️  Routine '${routine}' is disabled in agents-manifest.json. Running anyway via explicit command.`)
    );
  }

  console.log(pc.cyan(`\n🚀 Launching local agent session for routine: ${pc.bold(routine)}`));
  if (options.issue) {
    console.log(pc.dim(`   Target issue: #${options.issue}`));
  }
  if (options.pr) {
    console.log(pc.dim(`   Target pull request: #${options.pr}`));
  }
  if (options.model) {
    console.log(pc.dim(`   Model override: ${options.model}`));
  }
  if (options.verbose) {
    console.log(pc.dim(`   Verbose output: Enabled (streaming raw tokens)`));
  }
  if (options.worktree !== false) {
    console.log(pc.dim(`   Workspace isolation: Git Worktree (.jonah-fleet/worktrees/)`));
  } else {
    console.log(pc.yellow(`   Workspace isolation: Disabled (running in current directory)`));
  }
  console.log('');

  try {
    const result = await runLocalRoutine({
      targetDir: cwd,
      routine,
      issue: options.issue,
      pr: options.pr,
      model: options.model,
      printTimeout: options.timeout,
      noWorktree: options.worktree === false,
      keepWorktree: options.keepWorktree,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });

    if (options.dryRun) {
      console.log(pc.green(result.output));
      return;
    }

    if (result.success) {
      if (routine === 'peer-review') {
        const targetStr = options.pr ? `PR #${options.pr}` : 'PR';
        const outcome =
          result.outcome ||
          detectPeerReviewOutcome({
            output: result.output,
            prNumber: options.pr,
            repoRoot: cwd,
          });
        console.log('\n' + formatPeerReviewOutcomeMessage(targetStr, outcome, 'Local').trimEnd());
      } else {
        console.log(pc.green(`\n✓ Local agent session for '${routine}' completed successfully.`));
      }
    } else {
      console.error(pc.red(`\n✗ Local agent session for '${routine}' failed with exit code ${result.exitCode}.`));
      process.exit(result.exitCode);
    }
  } catch (error: any) {
    console.error(pc.red(`\n✗ Failed to execute routine '${routine}': ${error.message}`));
    process.exit(1);
  }
}
