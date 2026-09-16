import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runSync } from '../src/commands/sync.js';
import { createDefaultManifest, saveManifest, loadManifest } from '../src/lib/manifest.js';
import { installFleet } from '../src/lib/installer.js';
import { checkDrift } from '../src/lib/diff.js';
import { FLEET_VERSION } from '../src/lib/presets.js';

describe('Sync Fleet Workflow Logic & Drift Scenarios', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-sync-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects drift when prompt files are modified downstream', async () => {
    const manifest = createDefaultManifest('standard');
    saveManifest(tempDir, manifest);
    installFleet(tempDir, manifest);

    // Downstream user modifies prompt
    const promptPath = path.join(tempDir, '.github/prompts/autowork.md');
    fs.appendFileSync(promptPath, '\n# Local customization\n');

    const drift = checkDrift(tempDir, manifest);
    expect(drift.modifiedPrompts).toContain('autowork.md');
    expect(drift.missingPrompts.length).toBe(0);

    // Sync --force restores upstream pristine state
    await runSync({ force: true, cwd: tempDir });

    const postDrift = checkDrift(tempDir, manifest);
    expect(postDrift.modifiedPrompts.length).toBe(0);
  });

  it('detects drift when new fleet workflow or prompt is added in newer version', async () => {
    const manifest = createDefaultManifest('minimal');
    manifest.version = '1.0.0';
    saveManifest(tempDir, manifest);
    installFleet(tempDir, manifest);

    // Simulate missing workflow
    const wfPath = path.join(tempDir, '.github/workflows/prompt-optimizer-cron.yml');
    if (fs.existsSync(wfPath)) {
      fs.unlinkSync(wfPath);
    }

    const drift = checkDrift(tempDir, manifest);
    expect(drift.missingWorkflows).toContain('prompt-optimizer-cron.yml');

    // Run sync
    await runSync({ cwd: tempDir });

    const updatedManifest = loadManifest(tempDir);
    expect(updatedManifest?.version).toBe(FLEET_VERSION);
    expect(fs.existsSync(wfPath)).toBe(true);

    const postDrift = checkDrift(tempDir, updatedManifest!);
    expect(postDrift.missingWorkflows.length).toBe(0);
  });

  it('verifies sync-fleet.yml workflow template structure and commands', () => {
    const wfPath = path.join(process.cwd(), 'templates/workflows/sync-fleet.yml');
    const content = fs.readFileSync(wfPath, 'utf8');

    expect(content).toContain('npx --yes jonah-fleet sync --check');
    expect(content).toContain('npx --yes jonah-fleet sync --force');
    expect(content).toContain('git checkout -B "$BRANCH_NAME"');
    expect(content).toContain('gh pr create');
    expect(content).toContain('--title "chore(fleet): sync prompt routines and workflows from jonah-fleet"');
  });

  it('respects manifest schedules on sync without reporting false drift', async () => {
    const manifest = createDefaultManifest('standard');
    manifest.schedules = {
      autowork: '0 * * * *',
    };
    saveManifest(tempDir, manifest);
    installFleet(tempDir, manifest);

    const autoworkPath = path.join(tempDir, '.github/workflows/autowork-cron.yml');
    expect(fs.readFileSync(autoworkPath, 'utf8')).toContain("- cron: '0 * * * *'");

    // Check drift: should be zero
    const drift = checkDrift(tempDir, manifest);
    expect(drift.modifiedWorkflows.length).toBe(0);

    // Sync --force should keep the hourly cron
    await runSync({ force: true, cwd: tempDir });
    expect(fs.readFileSync(autoworkPath, 'utf8')).toContain("- cron: '0 * * * *'");

    const postDrift = checkDrift(tempDir, manifest);
    expect(postDrift.modifiedWorkflows.length).toBe(0);
  });

  it('preserves existing local workflow cron schedules across force syncs', async () => {
    const manifest = createDefaultManifest('standard');
    saveManifest(tempDir, manifest);
    installFleet(tempDir, manifest);

    // User customized cron in autowork-cron.yml directly to run every 30 minutes
    const autoworkPath = path.join(tempDir, '.github/workflows/autowork-cron.yml');
    let content = fs.readFileSync(autoworkPath, 'utf8');
    content = content.replace("cron: '15 */6 * * *'", "cron: '*/30 * * * *'");
    fs.writeFileSync(autoworkPath, content, 'utf8');

    // Drift check should recognize preserved cron as zero workflow drift
    const drift = checkDrift(tempDir, manifest);
    expect(drift.modifiedWorkflows.length).toBe(0);

    // Sync --force should not clobber the user's custom cron back to 6h
    await runSync({ force: true, cwd: tempDir });
    const postSyncContent = fs.readFileSync(autoworkPath, 'utf8');
    expect(postSyncContent).toContain("- cron: '*/30 * * * *'");
    expect(postSyncContent).not.toContain("- cron: '15 */6 * * *'");
  });

  it('updates workflow steps during force sync while preserving custom cron schedule', async () => {
    const manifest = createDefaultManifest('standard');
    saveManifest(tempDir, manifest);
    installFleet(tempDir, manifest);

    const autoworkPath = path.join(tempDir, '.github/workflows/autowork-cron.yml');
    let content = fs.readFileSync(autoworkPath, 'utf8');
    // Change cron to hourly AND modify a step
    content = content.replace("cron: '15 */6 * * *'", "cron: '0 * * * *'");
    content = content.replace('node-version: 22', 'node-version: 18');
    fs.writeFileSync(autoworkPath, content, 'utf8');

    // Drift check detects modified workflow because node-version drifted
    const drift = checkDrift(tempDir, manifest);
    expect(drift.modifiedWorkflows).toContain('autowork-cron.yml');

    // Force sync should update node-version back to 22 but preserve the 0 * * * * cron!
    await runSync({ force: true, cwd: tempDir });
    const postSyncContent = fs.readFileSync(autoworkPath, 'utf8');
    expect(postSyncContent).toContain("- cron: '0 * * * *'");
    expect(postSyncContent).toContain('node-version: 22');

    const postDrift = checkDrift(tempDir, manifest);
    expect(postDrift.modifiedWorkflows.length).toBe(0);
  });
});
