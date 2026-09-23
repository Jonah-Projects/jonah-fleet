import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createDefaultManifest } from '../src/lib/manifest.js';
import { FLEET_VERSION } from '../src/lib/presets.js';

describe('Manifest generation', () => {
  it('aligns FLEET_VERSION with package.json version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(FLEET_VERSION).toBe(pkg.version);
  });

  it('generates a standard manifest with standard routines', () => {
    const manifest = createDefaultManifest('standard');
    expect(manifest.version).toBe(FLEET_VERSION);
    expect(manifest.preset).toBe('standard');
    expect(manifest.routines.autowork).toBe(true);
    expect(manifest.routines['peer-review']).toBe(true);
    expect(manifest.routines.optimizer).toBe(true);
    expect(manifest.routines['issues-housekeeping']).toBe(true);
    expect(manifest.routines['product-planning']).toBe(false);
    expect(manifest.routines['analytics-review']).toBe(false);
    expect(manifest.routines['design-review']).toBe(false);
    expect(manifest.skills).toContain('tdd');
    expect(manifest.skills).toContain('code-review');
    expect(manifest.skills).toContain('grill-me');
  });

  it('generates a minimal manifest', () => {
    const manifest = createDefaultManifest('minimal');
    expect(manifest.preset).toBe('minimal');
    expect(manifest.routines.autowork).toBe(true);
    expect(manifest.routines['peer-review']).toBe(true);
    expect(manifest.routines.optimizer).toBe(true);
    expect(manifest.routines['issues-housekeeping']).toBe(false);
    expect(manifest.routines['analytics-review']).toBe(false);
    expect(manifest.routines['design-review']).toBe(false);
  });

  it('generates a full manifest', () => {
    const manifest = createDefaultManifest('full');
    expect(manifest.preset).toBe('full');
    expect(manifest.routines['product-planning']).toBe(true);
    expect(manifest.routines['analytics-review']).toBe(true);
    expect(manifest.routines['design-review']).toBe(true);
    expect(manifest.skills).toContain('grill-me');
    expect(manifest.skills).toContain('to-spec');
    expect(manifest.skills).toContain('to-tickets');
  });

  it('supports telemetry configuration in manifest', () => {
    const manifest = createDefaultManifest('standard');
    manifest.telemetry = {
      enabled: true,
      endpoint: 'https://telemetry.example.com/api/events',
      weeklyTokenBudget: 8_750_000,
    };
    expect(manifest.telemetry.enabled).toBe(true);
    expect(manifest.telemetry.weeklyTokenBudget).toBe(8_750_000);
  });

  it('supports custom cron schedules in manifest', () => {
    const manifest = createDefaultManifest('standard');
    manifest.schedules = {
      autowork: '0 * * * *',
      'peer-review': '0 */3 * * *',
      optimizer: '0 12 * * 0',
      'sync-fleet': '0 0 * * 1',
    };
    expect(manifest.schedules.autowork).toBe('0 * * * *');
    expect(manifest.schedules['peer-review']).toBe('0 */3 * * *');
    expect(manifest.schedules.optimizer).toBe('0 12 * * 0');
    expect(manifest.schedules['sync-fleet']).toBe('0 0 * * 1');
  });

  it('supports dualExecution configuration in manifest', () => {
    const manifest = createDefaultManifest('standard');
    manifest.dualExecution = {
      enabled: true,
      cloudPriorities: ['P0', 'P1'],
      cloudCatchupHours: 48,
    };
    expect(manifest.dualExecution.enabled).toBe(true);
    expect(manifest.dualExecution.cloudPriorities).toEqual(['P0', 'P1']);
    expect(manifest.dualExecution.cloudCatchupHours).toBe(48);
  });

  it('supports lessons configuration in manifest', () => {
    const manifest = createDefaultManifest('standard');
    manifest.lessons = {
      enabled: true,
      maxEntries: 25,
    };
    expect(manifest.lessons.enabled).toBe(true);
    expect(manifest.lessons.maxEntries).toBe(25);
  });

  it('includes default models and budgets in standard manifest', () => {
    const manifest = createDefaultManifest('standard');
    expect(manifest.models).toBeDefined();
    expect(manifest.models?.default).toBe('gemini-3.8-flash-high');
    expect(manifest.models?.['issues-housekeeping']).toBe('gemini-3.8-flash-medium');
    expect(manifest.budgets).toBeDefined();
    expect(manifest.budgets?.weeklyTokens).toBe(8_750_000);
    expect(manifest.budgets?.timeoutMinutes?.autowork).toBe(60);
    expect(manifest.budgets?.maxIterations?.autowork).toBe(65);
  });

  it('resolves routine configuration with defaults when manifest is empty', async () => {
    const { resolveRoutineConfig } = await import('../src/lib/manifest.js');
    const config = resolveRoutineConfig(null, 'autowork');
    expect(config.model).toBe('gemini-3.8-flash-high');
    expect(config.timeoutMinutes).toBe(60);
    expect(config.maxIterations).toBe(65);

    const housekeeping = resolveRoutineConfig(null, 'issues-housekeeping');
    expect(housekeeping.model).toBe('gemini-3.8-flash-medium');
    expect(housekeeping.timeoutMinutes).toBe(40);
  });

  it('resolves routine configuration with manifest overrides', async () => {
    const { resolveRoutineConfig } = await import('../src/lib/manifest.js');
    const manifest = createDefaultManifest('standard');
    manifest.models = {
      default: 'gemini-2.5-pro',
      autowork: 'gemini-3.7-flash-thinking',
    };
    manifest.budgets = {
      timeoutMinutes: {
        autowork: 90,
      },
      maxIterations: {
        autowork: 80,
      },
    };

    const autoworkConfig = resolveRoutineConfig(manifest, 'autowork');
    expect(autoworkConfig.model).toBe('gemini-3.7-flash-thinking');
    expect(autoworkConfig.timeoutMinutes).toBe(90);
    expect(autoworkConfig.maxIterations).toBe(80);

    const peerReviewConfig = resolveRoutineConfig(manifest, 'peer-review');
    expect(peerReviewConfig.model).toBe('gemini-2.5-pro'); // falls back to manifest.models.default
  });
});

