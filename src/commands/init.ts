import readline from 'node:readline';
import path from 'node:path';
import pc from 'picocolors';
import { createDefaultManifest, loadManifest, saveManifest } from '../lib/manifest.js';
import { installFleet } from '../lib/installer.js';
import { PresetName } from '../lib/presets.js';
import { detectTechStack, DetectedStack } from '../lib/detector.js';
import { pruneLabels } from '../lib/labels.js';
import { defaultGhExecutor, GhExecutor } from '../lib/fleet-query.js';

import { renderFleetBanner } from '../lib/brand.js';

export interface InitOptions {
  preset?: string;
  force?: boolean;
  cwd?: string;
  stack?: string;
  packageManager?: string;
  testCmd?: string;
  buildCmd?: string;
  interactive?: boolean;
  pruneLabels?: boolean;
  executor?: GhExecutor;
}

export async function promptQuestion(query: string, defaultValue: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${query} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const preset = (options.preset || 'standard') as PresetName;

  console.log(
    renderFleetBanner({
      command: 'INIT',
      subtitle: `INITIALIZING FLEET (preset: ${preset})`,
      details: [
        { label: 'Preset', value: preset },
        { label: 'Target', value: cwd },
      ],
    })
  );
  console.log(pc.cyan(`\n⚓ Initializing Jonah Fleet (preset: ${pc.bold(preset)}) in ${cwd}\n`));

  // 1. Auto-detect tech stack
  let detected = detectTechStack(cwd);
  console.log(pc.bold('🔍 Tech Stack Auto-Detection:'));
  console.log(pc.cyan(`  - Detected Stack:    ${pc.bold(detected.name)}`));
  console.log(pc.cyan(`  - Language:          ${detected.language}`));
  if (detected.framework) {
    console.log(pc.cyan(`  - Framework:         ${detected.framework}`));
  }
  console.log(pc.cyan(`  - Package Manager:   ${detected.packageManager}`));
  if (detected.testFramework) {
    console.log(pc.cyan(`  - Testing:           ${detected.testFramework}`));
  }
  if (detected.commands.test) {
    console.log(pc.cyan(`  - Test Command:      ${detected.commands.test}`));
  }

  // 2. Interactive prompt overrides if requested and running in interactive TTY
  const isInteractive = options.interactive ?? (process.stdin.isTTY && !options.stack && !options.testCmd);
  if (isInteractive && process.stdin.isTTY) {
    console.log(pc.yellow('\n⚙️  Configure project settings (press enter to accept defaults):'));
    const stackName = await promptQuestion('Tech Stack Name', detected.name);
    const pkgManager = await promptQuestion('Package Manager', detected.packageManager);
    const testCmd = await promptQuestion('Test Command', detected.commands.test || 'npm test');
    const buildCmd = await promptQuestion('Build Command', detected.commands.build || 'npm run build');

    detected = {
      ...detected,
      name: stackName,
      language: stackName,
      framework: undefined,
      packageManager: pkgManager,
      commands: {
        ...detected.commands,
        test: testCmd,
        build: buildCmd,
      },
    };
  }

  // 3. Command-line flag overrides
  if (options.stack) {
    detected.name = options.stack;
    detected.language = options.stack;
    detected.framework = undefined;
  }
  if (options.packageManager) {
    detected.packageManager = options.packageManager;
  }
  if (options.testCmd) {
    detected.commands.test = options.testCmd;
  }
  if (options.buildCmd) {
    detected.commands.build = options.buildCmd;
  }

  // 4. Manifest handling
  let manifest = loadManifest(cwd);
  if (manifest && !options.force) {
    console.log(pc.yellow(`\n⚠️  Found existing agents-manifest.json. Updating with preset '${preset}'...`));
  } else {
    manifest = createDefaultManifest(preset);
  }

  saveManifest(cwd, manifest);
  console.log(pc.green(`✓ Created/Updated agents-manifest.json`));

  // 5. Install fleet components
  const result = installFleet(cwd, manifest, { force: options.force, detectedStack: detected });

  console.log(pc.bold('\nInstalled components:'));
  if (result.promptsInstalled.length > 0) {
    console.log(pc.green(`  📁 Prompts (.github/prompts/):`));
    result.promptsInstalled.forEach((p) => console.log(`     - ${p}`));
  }
  if (result.workflowsInstalled.length > 0) {
    console.log(pc.green(`  ⚙️ Workflows (.github/workflows/):`));
    result.workflowsInstalled.forEach((w) => console.log(`     - ${w}`));
  }
  if (result.skillsInstalled.length > 0) {
    console.log(pc.green(`  🧠 Skills (.agents/skills/):`));
    result.skillsInstalled.forEach((s) => console.log(`     - ${s}`));
  }
  if (result.docsInstalled.length > 0) {
    console.log(pc.green(`  📄 Documentation:`));
    result.docsInstalled.forEach((d) => console.log(`     - ${d}`));
  }

  // 6. Optional boilerplate label pruning
  if (options.pruneLabels) {
    try {
      console.log(pc.bold('\n🏷️  Pruning unused boilerplate labels...'));
      const pruneRes = await pruneLabels({ cwd, yes: true, dryRun: false, executor: options.executor });
      if (pruneRes.pruned.length > 0) {
        console.log(pc.green(`  ✓ Pruned ${pruneRes.pruned.length} unused boilerplate label(s): ${pruneRes.pruned.join(', ')}`));
      } else {
        console.log(pc.green('  ✓ No unused boilerplate labels found.'));
      }
    } catch (err: any) {
      console.log(pc.yellow(`  ⚠️  Could not prune labels: ${err.message}`));
    }
  }

  console.log(pc.bold(pc.green('\n🎉 Jonah Fleet initialization complete!\n')));
  console.log(pc.cyan('Next steps for GitHub repository configuration:'));
  console.log('  1. In Settings → Actions → General → Workflow permissions:');
  console.log('     Select "Read and write permissions" and check "Allow GitHub Actions to create and approve pull requests".');
  console.log('  2. In Settings → Actions → General → Fork pull request workflows:');
  console.log('     Configure workflow approval settings to prevent automated runs from stalling awaiting approval.');
  console.log('  3. Customize project context, build, and test commands in AGENTS.md.\n');
}
