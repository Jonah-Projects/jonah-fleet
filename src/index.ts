import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runSync } from './commands/sync.js';
import { runStatus } from './commands/status.js';
import { runMonitor } from './commands/monitor.js';
import { runContribute } from './commands/contribute.js';
import { runTelemetry } from './commands/telemetry.js';
import { runRoutineCommand } from './commands/run.js';
import { runDaemonCommand } from './commands/daemon.js';
import { runLabels } from './commands/labels.js';
import { FLEET_VERSION } from './lib/presets.js';

const program = new Command();

program
  .name('jonah-fleet')
  .description('Manage autonomous agent fleet, prompt routines, workflows, and skills')
  .version(FLEET_VERSION);

program
  .command('run <routine>')
  .description('Run a specific prompt routine locally in an isolated git worktree')
  .option('-i, --issue <number>', 'Targeted issue number for autowork')
  .option('-p, --pr <number>', 'Targeted pull request number for peer-review')
  .option('-m, --model <model>', 'LLM model override (defaults to gemini-3.8-flash-high)')
  .option('--timeout <duration>', 'CLI execution print timeout (default: 30m)')
  .option('--no-worktree', 'Execute directly in current directory without creating a git worktree')
  .option('--keep-worktree', 'Preserve the git worktree after routine execution completes')
  .option('-d, --dry-run', 'Preview prompt and execution parameters without launching agent')
  .option('-v, --verbose', 'Stream raw agent tokens and logs directly to stdout')
  .action(async (routine, options) => {
    await runRoutineCommand(routine, options);
  });

program
  .command('daemon [action]')
  .description('Manage background local worker daemon polling for unclaimed issues and pull requests')
  .option('-i, --interval <minutes>', 'Legacy global polling interval in minutes (default: 30)')
  .option('--review-interval <minutes>', 'Peer Review watchdog cadence in minutes (default: 3)')
  .option('--autowork-interval <minutes>', 'Autowork backlog cadence in minutes (default: 30)')
  .option('-r, --routines <list>', 'Comma-separated routines to run (default: peer-review,autowork)')
  .option('-m, --model <model>', 'LLM model override')
  .option('--foreground', 'Run daemon in foreground with live console logs')
  .option('-v, --verbose', 'Stream raw agent tokens and logs directly to stdout')
  .action(async (action, options) => {
    await runDaemonCommand(action, options);
  });

program
  .command('labels [action]')
  .description('Audit, prune, or provision repository labels for autonomous fleet taxonomy (audit | prune | provision)')
  .option('-d, --dry-run', 'Preview prunable labels without deleting them', false)
  .option('-y, --yes', 'Confirm automatic deletion of prunable labels', false)
  .option('-r, --repo <repo>', 'Target GitHub repository (defaults to current)')
  .option('-j, --json', 'Output results as JSON', false)
  .action(async (action, options) => {
    const act =
      action === 'prune' || action === 'list' || action === 'audit' || action === 'provision' || action === 'sync'
        ? (action as 'audit' | 'list' | 'prune' | 'provision')
        : 'audit';
    await runLabels(act, options);
  });

program
  .command('init')
  .description('Initialize Jonah Fleet configuration, routines, workflows, and skills in the current repo')
  .option('-p, --preset <preset>', 'Preset profile to install (minimal | standard | full)', 'standard')
  .option('-f, --force', 'Force overwrite existing files', false)
  .option('--stack <stack>', 'Override detected tech stack name')
  .option('--package-manager <pm>', 'Override package manager (npm, pnpm, yarn, bun, uv, poetry, cargo, go)')
  .option('--test-cmd <cmd>', 'Override test execution command')
  .option('--build-cmd <cmd>', 'Override build execution command')
  .option('--prune-labels', 'Prune unused boilerplate labels on initialization', false)
  .option('--interactive', 'Force interactive prompts for stack configuration')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options) => {
    await runInit(options);
  });

program
  .command('sync')
  .description('Synchronize local prompts, workflows, and skills with the installed fleet version')
  .option('-c, --check', 'Check for drift without writing changes', false)
  .option('-f, --force', 'Force update all files to match fleet version', false)
  .action(async (options) => {
    await runSync(options);
  });

program
  .command('status')
  .description('Check the status, health, and drift of installed agent routines and skills')
  .option('-f, --fleet', 'Display multi-repository fleet monitor overview', false)
  .option('-t, --tokens', 'Display detailed per-agent token and cost breakdown', false)
  .option('--detailed', 'Display detailed metrics breakdown', false)
  .option('-j, --json', 'Output status as JSON', false)
  .action(async (options) => {
    await runStatus(options);
  });

program
  .command('monitor [repos...]')
  .description('Monitor health, active claims, PR review loops, and token spend across fleet repositories')
  .option('-t, --tokens', 'Display detailed per-agent token and cost breakdown', false)
  .option('--detailed', 'Display detailed metrics breakdown', false)
  .option('-j, --json', 'Output telemetry as JSON', false)
  .option('-w, --watch', 'Live watch and refresh dashboard', false)
  .option('-i, --interval <seconds>', 'Refresh interval in seconds for watch mode', '10')
  .option('-a, --all', 'Query all registered repositories from config and manifest', false)
  .option('--add <repo>', 'Add a repository to the fleet registry')
  .option('--remove <repo>', 'Remove a repository from the fleet registry')
  .action(async (repos, options) => {
    await runMonitor({ ...options, repos });
  });

program
  .command('contribute')
  .description('Submit local prompt improvements back upstream to jonah-fleet')
  .option('-t, --title <title>', 'Contribution PR title')
  .option('-b, --body <body>', 'Contribution PR description')
  .option('-p, --prompt <prompt>', 'Target prompt template being refined')
  .option('-r, --repo <repo>', 'Upstream target repository (defaults to juliendurandeu/jonah-fleet)')
  .option('-d, --dry-run', 'Preview contribution branch and PR command without executing', false)
  .action(async (options) => {
    await runContribute(options);
  });

program
  .command('telemetry [repos...]')
  .description('Aggregate and report fleet-wide telemetry, review loop metrics, failure categories, and weekly token spend')
  .option('-l, --log <path>', 'Path to markdown log file to emit')
  .option('-e, --endpoint <url>', 'Collector endpoint URL for telemetry emission')
  .option('-b, --budget <tokens>', 'Weekly token budget ceiling (~8.75M default)')
  .option('-j, --json', 'Output telemetry summary as JSON', false)
  .option('--emit', 'Emit telemetry event for specified or latest run log')
  .action(async (repos, options) => {
    const action = options.emit ? 'emit' : 'aggregate';
    await runTelemetry({ ...options, repos, action });
  });

program.parse(process.argv);
