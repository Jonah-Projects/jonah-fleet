import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PresetName = 'minimal' | 'standard' | 'full' | 'custom';

export interface RoutineModels {
  default?: string;
  autowork?: string;
  'peer-review'?: string;
  optimizer?: string;
  'issues-housekeeping'?: string;
  'dependency-update-security-check'?: string;
  'product-planning'?: string;
  'analytics-review'?: string;
  'design-review'?: string;
  [key: string]: string | undefined;
}

export interface RoutineBudgets {
  weeklyTokens?: number;
  maxIterations?: {
    default?: number;
    autowork?: number;
    'peer-review'?: number;
    optimizer?: number;
    'issues-housekeeping'?: number;
    'dependency-update-security-check'?: number;
    'product-planning'?: number;
    'analytics-review'?: number;
    'design-review'?: number;
    [key: string]: number | undefined;
  };
  timeoutMinutes?: {
    default?: number;
    autowork?: number;
    'peer-review'?: number;
    optimizer?: number;
    'issues-housekeeping'?: number;
    'dependency-update-security-check'?: number;
    'product-planning'?: number;
    'analytics-review'?: number;
    'design-review'?: number;
    [key: string]: number | undefined;
  };
}

export interface FleetManifest {
  $schema?: string;
  version: string;
  preset: PresetName;
  routines: {
    autowork: boolean;
    'peer-review': boolean;
    optimizer: boolean;
    'issues-housekeeping': boolean;
    'dependency-update-security-check': boolean;
    'product-planning': boolean;
    'analytics-review': boolean;
    'design-review': boolean;
  };
  schedules?: {
    autowork?: string;
    'peer-review'?: string;
    optimizer?: string;
    'issues-housekeeping'?: string;
    'dependency-update-security-check'?: string;
    'analytics-review'?: string;
    'design-review'?: string;
    'sync-fleet'?: string;
    [key: string]: string | undefined;
  };
  skills: string[];
  models?: RoutineModels;
  budgets?: RoutineBudgets;
  repositories?: string[];
  autoUpdate?: {
    enabled: boolean;
    channel: 'stable' | 'latest';
  };
  telemetry?: {
    enabled?: boolean;
    endpoint?: string;
    weeklyTokenBudget?: number;
  };
  dualExecution?: DualExecutionConfig;
  labels?: {
    protected?: string[];
  };
  lessons?: boolean | LessonsConfig;
}

export interface LessonsConfig {
  enabled?: boolean;
  maxEntries?: number;
}

export const DEFAULT_ROUTINE_MODELS: Record<string, string> = {
  autowork: 'gemini-3.8-flash-high',
  'peer-review': 'gemini-3.8-flash-high',
  optimizer: 'gemini-3.8-flash-high',
  'issues-housekeeping': 'gemini-3.8-flash-medium',
  'dependency-update-security-check': 'gemini-3.8-flash-medium',
  'product-planning': 'gemini-3.8-flash-high',
  'analytics-review': 'gemini-3.8-flash-medium',
  'design-review': 'gemini-3.8-flash-high',
};

export const DEFAULT_ROUTINE_TIMEOUTS: Record<string, number> = {
  autowork: 60,
  'peer-review': 55,
  optimizer: 35,
  'issues-housekeeping': 40,
  'dependency-update-security-check': 25,
  'product-planning': 45,
  'analytics-review': 30,
  'design-review': 50,
};

export const DEFAULT_ROUTINE_MAX_ITERATIONS: Record<string, number> = {
  autowork: 65,
  'peer-review': 40,
  optimizer: 30,
  'issues-housekeeping': 30,
  'dependency-update-security-check': 20,
  'product-planning': 40,
  'analytics-review': 25,
  'design-review': 30,
};

export const DEFAULT_MODELS_CONFIG: RoutineModels = {
  default: 'gemini-3.8-flash-high',
  'issues-housekeeping': 'gemini-3.8-flash-medium',
  'dependency-update-security-check': 'gemini-3.8-flash-medium',
  'analytics-review': 'gemini-3.8-flash-medium',
};

export const DEFAULT_BUDGETS_CONFIG: RoutineBudgets = {
  weeklyTokens: 8750000,
  timeoutMinutes: {
    autowork: 60,
    'peer-review': 55,
    optimizer: 35,
    'issues-housekeeping': 40,
    'dependency-update-security-check': 25,
    'product-planning': 45,
    'analytics-review': 30,
    'design-review': 50,
  },
  maxIterations: {
    autowork: 65,
    'peer-review': 40,
    optimizer: 30,
    'issues-housekeeping': 30,
    'dependency-update-security-check': 20,
    'product-planning': 40,
    'analytics-review': 25,
    'design-review': 30,
  },
};


export interface DualExecutionConfig {
  enabled?: boolean;
  cloudPriorities?: string[];
  cloudCatchupHours?: number;
}

export const DEFAULT_DUAL_EXECUTION_CONFIG: DualExecutionConfig = {
  enabled: true,
  cloudPriorities: ['P0', 'P1'],
  cloudCatchupHours: 48,
};

export const PRESET_CONFIGS: Record<Exclude<PresetName, 'custom'>, { routines: FleetManifest['routines']; skills: string[] }> = {
  minimal: {
    routines: {
      autowork: true,
      'peer-review': true,
      optimizer: true,
      'issues-housekeeping': false,
      'dependency-update-security-check': false,
      'product-planning': false,
      'analytics-review': false,
      'design-review': false,
    },
    skills: [
      'tdd',
      'code-review',
      'diagnosing-bugs',
      'resolving-merge-conflicts',
      'writing-for-agents',
    ],
  },
  standard: {
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
    skills: [
      'tdd',
      'code-review',
      'codebase-design',
      'domain-modeling',
      'diagnosing-bugs',
      'resolving-merge-conflicts',
      'writing-for-agents',
      'triage',
      'grill-me',
    ],
  },
  full: {
    routines: {
      autowork: true,
      'peer-review': true,
      optimizer: true,
      'issues-housekeeping': true,
      'dependency-update-security-check': true,
      'product-planning': true,
      'analytics-review': true,
      'design-review': true,
    },
    skills: [
      'tdd',
      'code-review',
      'codebase-design',
      'domain-modeling',
      'diagnosing-bugs',
      'resolving-merge-conflicts',
      'writing-for-agents',
      'triage',
      'grill-me',
      'to-spec',
      'to-tickets',
    ],
  },
};

export const ROUTINE_TO_WORKFLOW_MAP: Record<keyof FleetManifest['routines'], string[]> = {
  autowork: [
    'autowork-cron.yml',
    'trigger-autowork-on-merge.yml',
    'trigger-autowork-on-bug.yml',
    'trigger-autowork-manual.yml',
    'trigger-autowork-on-assign.yml',
  ],
  'peer-review': ['trigger-review-routine.yml'],
  optimizer: ['prompt-optimizer-cron.yml'],
  'issues-housekeeping': ['issues-housekeeping-cron.yml'],
  'dependency-update-security-check': ['dependency-check-cron.yml'],
  'product-planning': [],
  'analytics-review': ['analytics-review-cron.yml'],
  'design-review': ['design-review-cron.yml'],
};

export const WORKFLOW_TO_ROUTINE_MAP: Record<string, keyof FleetManifest['routines'] | 'sync-fleet'> = {
  'autowork-cron.yml': 'autowork',
  'trigger-autowork-on-merge.yml': 'autowork',
  'trigger-autowork-on-bug.yml': 'autowork',
  'trigger-autowork-manual.yml': 'autowork',
  'trigger-autowork-on-assign.yml': 'autowork',
  'trigger-review-routine.yml': 'peer-review',
  'prompt-optimizer-cron.yml': 'optimizer',
  'issues-housekeeping-cron.yml': 'issues-housekeeping',
  'dependency-check-cron.yml': 'dependency-update-security-check',
  'analytics-review-cron.yml': 'analytics-review',
  'design-review-cron.yml': 'design-review',
  'sync-fleet.yml': 'sync-fleet',
};

function resolveFleetVersion(): string {
  try {
    let currentDir = path.dirname(fileURLToPath(import.meta.url));
    while (currentDir && currentDir !== path.dirname(currentDir)) {
      const candidate = path.join(currentDir, 'package.json');
      if (fs.existsSync(candidate)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (pkg.name === 'jonah-fleet' && pkg.version) {
            return pkg.version;
          }
        } catch {
          // ignore error and continue searching
        }
      }
      currentDir = path.dirname(currentDir);
    }
  } catch {
    // fallback
  }
  return '1.26.0';
}

export const FLEET_VERSION = resolveFleetVersion();
export const SCHEMA_URL = 'https://raw.githubusercontent.com/Jonah-Projects/jonah-fleet/main/schema.json';
