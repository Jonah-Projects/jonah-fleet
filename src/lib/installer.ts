import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FleetManifest, ROUTINE_TO_WORKFLOW_MAP } from './presets.js';
import { DetectedStack, detectTechStack, renderAgentsTemplate } from './detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getTemplatesDir(): string {
  // Check if running from dist/ or src/
  const candidate1 = path.resolve(__dirname, '../templates');
  const candidate2 = path.resolve(__dirname, '../../templates');
  if (fs.existsSync(candidate1)) return candidate1;
  if (fs.existsSync(candidate2)) return candidate2;
  throw new Error(`Templates directory not found at ${candidate1} or ${candidate2}`);
}

export interface InstallResult {
  promptsInstalled: string[];
  workflowsInstalled: string[];
  skillsInstalled: string[];
  docsInstalled: string[];
}

export interface InstallOptions {
  force?: boolean;
  detectedStack?: DetectedStack;
}

/**
 * Replaces the first `- cron: '...'` or `- cron: "..."` inside a workflow file with the given custom cron expression.
 */
export function applyWorkflowSchedule(content: string, customCron?: string): string {
  if (!customCron) return content;
  return content.replace(
    /(-\s*cron:\s*['"])([^'"]+)(['"])/,
    `$1${customCron}$3`
  );
}

/**
 * Extracts the cron expression from a workflow content string if present.
 */
export function extractWorkflowSchedule(content: string): string | null {
  const match = content.match(/-\s*cron:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

/**
 * Resolves the desired schedule for a workflow according to manifest preferences or existing target file content.
 */
export function resolveWorkflowSchedule(
  workflowFile: string,
  routineName: string | undefined,
  manifest: FleetManifest,
  destContent?: string
): string | undefined {
  // 1. Explicit manifest schedules by routineName
  if (routineName && manifest.schedules?.[routineName]) {
    return manifest.schedules[routineName];
  }
  // 2. Explicit manifest schedules by workflow filename or basename
  if (manifest.schedules?.[workflowFile]) {
    return manifest.schedules[workflowFile];
  }
  const baseName = workflowFile.replace(/\.(yml|yaml)$/, '');
  if (manifest.schedules?.[baseName]) {
    return manifest.schedules[baseName];
  }
  // 3. Existing destination content preservation (local custom cron)
  if (destContent) {
    const existingCron = extractWorkflowSchedule(destContent);
    if (existingCron) {
      return existingCron;
    }
  }
  return undefined;
}

export function installFleet(targetDir: string, manifest: FleetManifest, options: InstallOptions = {}): InstallResult {
  const templatesDir = getTemplatesDir();
  const result: InstallResult = {
    promptsInstalled: [],
    workflowsInstalled: [],
    skillsInstalled: [],
    docsInstalled: [],
  };

  const targetPromptsDir = path.join(targetDir, '.github/prompts');
  const targetWorkflowsDir = path.join(targetDir, '.github/workflows');
  const targetSkillsDir = path.join(targetDir, '.agents/skills');

  fs.mkdirSync(targetPromptsDir, { recursive: true });
  fs.mkdirSync(targetWorkflowsDir, { recursive: true });
  fs.mkdirSync(targetSkillsDir, { recursive: true });

  // 1. Install base prompt files
  const basePrompts = ['ORCHESTRATION.md', '_prompt-template.md'];
  for (const file of basePrompts) {
    const src = path.join(templatesDir, 'prompts', file);
    const dest = path.join(targetPromptsDir, file);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dest) || options.force) {
        fs.copyFileSync(src, dest);
        result.promptsInstalled.push(file);
      }
    }
  }

  // 2. Install enabled routines and their workflows
  for (const [routineName, isEnabled] of Object.entries(manifest.routines)) {
    if (!isEnabled) continue;

    // Prompt file
    const promptFile = `${routineName}.md`;
    const promptSrc = path.join(templatesDir, 'prompts', promptFile);
    const promptDest = path.join(targetPromptsDir, promptFile);
    if (fs.existsSync(promptSrc)) {
      if (!fs.existsSync(promptDest) || options.force) {
        fs.copyFileSync(promptSrc, promptDest);
        result.promptsInstalled.push(promptFile);
      }
    }

    // Associated Workflows
    const workflows = ROUTINE_TO_WORKFLOW_MAP[routineName as keyof FleetManifest['routines']] || [];
    for (const workflowFile of workflows) {
      const wfSrc = path.join(templatesDir, 'workflows', workflowFile);
      const wfDest = path.join(targetWorkflowsDir, workflowFile);
      if (fs.existsSync(wfSrc)) {
        if (!fs.existsSync(wfDest) || options.force) {
          const rawContent = fs.readFileSync(wfSrc, 'utf8');
          const destContent = fs.existsSync(wfDest) ? fs.readFileSync(wfDest, 'utf8') : undefined;
          const schedule = resolveWorkflowSchedule(workflowFile, routineName, manifest, destContent);
          const finalContent = applyWorkflowSchedule(rawContent, schedule);
          fs.writeFileSync(wfDest, finalContent, 'utf8');
          result.workflowsInstalled.push(workflowFile);
        }
      }
    }
  }

  // 3. Install sync workflow if autoUpdate is enabled
  if (manifest.autoUpdate?.enabled) {
    const syncWfSrc = path.join(templatesDir, 'workflows/sync-fleet.yml');
    const syncWfDest = path.join(targetWorkflowsDir, 'sync-fleet.yml');
    if (fs.existsSync(syncWfSrc)) {
      if (!fs.existsSync(syncWfDest) || options.force) {
        const rawContent = fs.readFileSync(syncWfSrc, 'utf8');
        const destContent = fs.existsSync(syncWfDest) ? fs.readFileSync(syncWfDest, 'utf8') : undefined;
        const schedule = resolveWorkflowSchedule('sync-fleet.yml', 'sync-fleet', manifest, destContent);
        const finalContent = applyWorkflowSchedule(rawContent, schedule);
        fs.writeFileSync(syncWfDest, finalContent, 'utf8');
        result.workflowsInstalled.push('sync-fleet.yml');
      }
    }
  }

  // 4. Install selected skills
  for (const skill of manifest.skills) {
    const skillSrcDir = path.join(templatesDir, 'skills', skill);
    const skillDestDir = path.join(targetSkillsDir, skill);
    if (fs.existsSync(skillSrcDir)) {
      if (!fs.existsSync(skillDestDir) || options.force) {
        fs.cpSync(skillSrcDir, skillDestDir, { recursive: true });
        result.skillsInstalled.push(skill);
      }
    }
  }

  // 5. Install AGENTS.md template if neither AGENTS.md, CLAUDE.md nor GEMINI.md exists
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  const claudePath = path.join(targetDir, 'CLAUDE.md');
  const geminiPath = path.join(targetDir, 'GEMINI.md');
  if ((!fs.existsSync(agentsPath) && !fs.existsSync(claudePath) && !fs.existsSync(geminiPath)) || options.force) {
    const docSrc = path.join(templatesDir, 'docs/AGENTS.template.md');
    if (fs.existsSync(docSrc)) {
      const templateContent = fs.readFileSync(docSrc, 'utf8');
      const stack = options.detectedStack || detectTechStack(targetDir);
      const renderedContent = renderAgentsTemplate(templateContent, stack);
      fs.writeFileSync(agentsPath, renderedContent, 'utf8');
      result.docsInstalled.push('AGENTS.md');
    }
  }

  // 6. Install LESSONS.md template if enabled in manifest and LESSONS.md does not exist
  const lessonsEnabled = manifest.lessons === true || (typeof manifest.lessons === 'object' && manifest.lessons?.enabled);
  if (lessonsEnabled) {
    const lessonsPath = path.join(targetDir, 'LESSONS.md');
    if (!fs.existsSync(lessonsPath) || options.force) {
      const lessonsSrc = path.join(templatesDir, 'docs/LESSONS.template.md');
      if (fs.existsSync(lessonsSrc)) {
        fs.copyFileSync(lessonsSrc, lessonsPath);
        result.docsInstalled.push('LESSONS.md');
      }
    }
  }

  return result;
}
