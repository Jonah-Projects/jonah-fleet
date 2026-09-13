import fs from 'node:fs';
import path from 'node:path';
import {
  FleetManifest,
  FLEET_VERSION,
  PRESET_CONFIGS,
  PresetName,
  SCHEMA_URL,
  RoutineModels,
  RoutineBudgets,
  DEFAULT_ROUTINE_MODELS,
  DEFAULT_ROUTINE_TIMEOUTS,
  DEFAULT_ROUTINE_MAX_ITERATIONS,
  DEFAULT_MODELS_CONFIG,
  DEFAULT_BUDGETS_CONFIG,
} from './presets.js';

export const MANIFEST_FILENAME = 'agents-manifest.json';

export interface ResolvedRoutineConfig {
  model: string;
  timeoutMinutes: number;
  maxIterations?: number;
}

export function resolveRoutineConfig(
  manifest: FleetManifest | null,
  routine: keyof FleetManifest['routines'] | string
): ResolvedRoutineConfig {
  const defaultModel = DEFAULT_ROUTINE_MODELS[routine] || 'gemini-3.7-flash-high';
  const defaultTimeout = DEFAULT_ROUTINE_TIMEOUTS[routine] || 45;
  const defaultIterations = DEFAULT_ROUTINE_MAX_ITERATIONS[routine];

  const model =
    manifest?.models?.[routine as keyof RoutineModels] ||
    manifest?.models?.default ||
    defaultModel;

  const timeoutMinutes =
    manifest?.budgets?.timeoutMinutes?.[routine as keyof NonNullable<RoutineBudgets['timeoutMinutes']>] ||
    manifest?.budgets?.timeoutMinutes?.default ||
    defaultTimeout;

  const maxIterations =
    manifest?.budgets?.maxIterations?.[routine as keyof NonNullable<RoutineBudgets['maxIterations']>] ||
    manifest?.budgets?.maxIterations?.default ||
    defaultIterations;

  return {
    model,
    timeoutMinutes,
    ...(maxIterations !== undefined ? { maxIterations } : {}),
  };
}

export function loadManifest(targetDir: string): FleetManifest | null {
  const manifestPath = path.join(targetDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw) as FleetManifest;
  } catch {
    return null;
  }
}

export function saveManifest(targetDir: string, manifest: FleetManifest): void {
  const manifestPath = path.join(targetDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function createDefaultManifest(preset: PresetName = 'standard'): FleetManifest {
  if (preset === 'custom') {
    return {
      $schema: SCHEMA_URL,
      version: FLEET_VERSION,
      preset: 'custom',
      routines: {
        autowork: true,
        'peer-review': true,
        optimizer: true,
        'issues-housekeeping': true,
        'dependency-update-security-check': true,
        'product-planning': false,
        'analytics-review': false,
        'design-review': false,
      },
      skills: PRESET_CONFIGS.standard.skills,
      models: { ...DEFAULT_MODELS_CONFIG },
      budgets: {
        weeklyTokens: DEFAULT_BUDGETS_CONFIG.weeklyTokens,
        timeoutMinutes: { ...DEFAULT_BUDGETS_CONFIG.timeoutMinutes },
        maxIterations: { ...DEFAULT_BUDGETS_CONFIG.maxIterations },
      },
      autoUpdate: {
        enabled: true,
        channel: 'stable',
      },
    };
  }

  const config = PRESET_CONFIGS[preset];
  return {
    $schema: SCHEMA_URL,
    version: FLEET_VERSION,
    preset,
    routines: { ...config.routines },
    skills: [...config.skills],
    models: { ...DEFAULT_MODELS_CONFIG },
    budgets: {
      weeklyTokens: DEFAULT_BUDGETS_CONFIG.weeklyTokens,
      timeoutMinutes: { ...DEFAULT_BUDGETS_CONFIG.timeoutMinutes },
      maxIterations: { ...DEFAULT_BUDGETS_CONFIG.maxIterations },
    },
    autoUpdate: {
      enabled: true,
      channel: 'stable',
    },
  };
}

