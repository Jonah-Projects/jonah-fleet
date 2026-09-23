import pc from 'picocolors';
import { loadManifest, saveManifest } from '../lib/manifest.js';
import { installFleet } from '../lib/installer.js';
import { checkDrift } from '../lib/diff.js';
import { FLEET_VERSION } from '../lib/presets.js';
import { provisionLabels } from '../lib/labels.js';
import { renderFleetBanner } from '../lib/brand.js';

export interface SyncOptions {
  check?: boolean;
  force?: boolean;
  cwd?: string;
}

export async function runSync(options: SyncOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const manifest = loadManifest(cwd);

  if (!manifest) {
    console.error(pc.red(`❌ No agents-manifest.json found in ${cwd}. Run 'jonah-fleet init' first.`));
    process.exit(1);
  }

  console.log(
    renderFleetBanner({
      command: 'SYNC',
      subtitle: `SYNCHRONIZING FLEET (v${manifest.version} -> v${FLEET_VERSION})`,
      details: [
        { label: 'Installed', value: `v${manifest.version}` },
        { label: 'Upstream', value: `v${FLEET_VERSION}` },
        {
          label: 'Mode',
          value: options.check ? 'Check Drift' : options.force ? 'Force Overwrite' : 'Standard Sync',
        },
      ],
    })
  );
  console.log(pc.cyan(`\n🔄 Syncing Jonah Fleet (current: v${manifest.version}, fleet: v${FLEET_VERSION})...\n`));

  const drift = checkDrift(cwd, manifest);
  const hasDrift =
    drift.missingPrompts.length > 0 ||
    drift.modifiedPrompts.length > 0 ||
    drift.missingWorkflows.length > 0 ||
    drift.modifiedWorkflows.length > 0 ||
    drift.missingSkills.length > 0;

  if (options.check) {
    if (!hasDrift && manifest.version === FLEET_VERSION) {
      console.log(pc.green(`✓ All routines, workflows, and skills are perfectly in sync with v${FLEET_VERSION}.\n`));
      return;
    }

    console.log(pc.yellow(`⚠️ Drift or updates detected:`));
    if (drift.missingPrompts.length > 0) console.log(pc.red(`  Missing prompts: ${drift.missingPrompts.join(', ')}`));
    if (drift.modifiedPrompts.length > 0) console.log(pc.yellow(`  Modified prompts: ${drift.modifiedPrompts.join(', ')}`));
    if (drift.missingWorkflows.length > 0) console.log(pc.red(`  Missing workflows: ${drift.missingWorkflows.join(', ')}`));
    if (drift.modifiedWorkflows.length > 0) console.log(pc.yellow(`  Modified workflows: ${drift.modifiedWorkflows.join(', ')}`));
    if (drift.missingSkills.length > 0) console.log(pc.red(`  Missing skills: ${drift.missingSkills.join(', ')}`));
    console.log(pc.cyan(`\nRun 'jonah-fleet sync --force' to apply updates.\n`));
    return;
  }

  // Update manifest version
  manifest.version = FLEET_VERSION;
  saveManifest(cwd, manifest);

  const result = installFleet(cwd, manifest, { force: true });
  console.log(pc.green(`✓ Synchronized with Jonah Fleet v${FLEET_VERSION}`));
  console.log(pc.green(`✓ Updated ${result.promptsInstalled.length} prompts, ${result.workflowsInstalled.length} workflows, and ${result.skillsInstalled.length} skills.`));

  // Attempt to provision core fleet labels (graceful fallback if offline or no gh auth)
  try {
    const labelRes = await provisionLabels({ cwd });
    if (labelRes.created.length > 0) {
      console.log(pc.green(`✓ Provisioned ${labelRes.created.length} missing fleet label(s)`));
    }
  } catch {}
  console.log();
}
