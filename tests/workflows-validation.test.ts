import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { getTemplatesDir } from '../src/lib/installer.js';
import { ROUTINE_TO_WORKFLOW_MAP } from '../src/lib/presets.js';

describe('Workflow Validation & Invariants', () => {
  const templatesDir = getTemplatesDir();
  const workflowsDir = path.join(templatesDir, 'workflows');

  it('includes trigger-autowork-manual.yml in ROUTINE_TO_WORKFLOW_MAP for autowork', () => {
    expect(ROUTINE_TO_WORKFLOW_MAP.autowork).toContain('trigger-autowork-manual.yml');
  });

  it('has trigger-autowork-manual.yml template with required inputs and steps', () => {
    const manualWorkflowPath = path.join(workflowsDir, 'trigger-autowork-manual.yml');
    expect(fs.existsSync(manualWorkflowPath)).toBe(true);

    const content = fs.readFileSync(manualWorkflowPath, 'utf8');
    expect(content).toContain('workflow_dispatch:');
    expect(content).toContain('issue_number:');
    expect(content).toContain('TARGET_ISSUE: ${{ inputs.issue_number }}');
    expect(content).toContain('Targeted mode');
    expect(content).toContain('gemini-3.8-flash-high');
    expect(content).toContain('Verify Atomic Handoff Invariant');
  });

  it('ensures autowork-cron.yml supports target_issue and issue_number inputs', () => {
    const cronWorkflowPath = path.join(workflowsDir, 'autowork-cron.yml');
    const content = fs.readFileSync(cronWorkflowPath, 'utf8');
    expect(content).toContain('workflow_dispatch:');
    expect(content).toContain('target_issue:');
    expect(content).toContain('issue_number:');
    expect(content).toContain('TARGET_ISSUE: ${{ inputs.target_issue || inputs.issue_number }}');
  });

  it('ensures autowork workflows authenticate checkout with GH_PAT token', () => {
    const autoworkWorkflows = [
      'autowork-cron.yml',
      'trigger-autowork-manual.yml',
      'trigger-autowork-on-bug.yml',
      'trigger-autowork-on-merge.yml',
    ];
    for (const file of autoworkWorkflows) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
      expect(content).toContain('token: ${{ secrets.GH_PAT || github.token }}');
    }
  });

  it('ensures autowork-cron.yml includes two-phase issue lifecycle reconciliation in both templates and .github', () => {
    const templatePath = path.join(workflowsDir, 'autowork-cron.yml');
    const githubPath = path.join(process.cwd(), '.github/workflows/autowork-cron.yml');
    for (const filePath of [templatePath, githubPath]) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('Initialize Routine Run Issue');
      expect(content).toContain('Reconcile Routine Run Issue');
      expect(content).toContain('routine-log');
      expect(content).toContain('status:running');
      expect(content).toContain('status:success');
      expect(content).toContain('Milestone: Run Interrupted / Failed');
      expect(content).toContain('gh issue comment "$ISSUE_NUMBER"');
    }
  });

  it('ensures analytics-review-cron.yml includes two-phase issue lifecycle reconciliation in templates', () => {
    expect(ROUTINE_TO_WORKFLOW_MAP['analytics-review']).toContain('analytics-review-cron.yml');
    const templatePath = path.join(workflowsDir, 'analytics-review-cron.yml');
    expect(fs.existsSync(templatePath)).toBe(true);
    const content = fs.readFileSync(templatePath, 'utf8');
    expect(content).toContain('Initialize Routine Run Issue');
    expect(content).toContain('Reconcile Routine Run Issue');
    expect(content).toContain('routine-log');
    expect(content).toContain('routine:analytics-review');
    expect(content).toContain('status:running');
    expect(content).toContain('status:success');
    expect(content).toContain('Milestone: Run Interrupted / Failed');
    expect(content).toContain('gh issue comment "$ISSUE_NUMBER"');
  });

  it('ensures all workflow templates exist in the templates directory', () => {
    for (const workflows of Object.values(ROUTINE_TO_WORKFLOW_MAP)) {
      for (const workflowFile of workflows) {
        const filePath = path.join(workflowsDir, workflowFile);
        expect(fs.existsSync(filePath), `Workflow file ${workflowFile} should exist in templates`).toBe(true);
      }
    }
  });

  it('verifies badge link template format in docs and templates', () => {
    const agentsTemplate = fs.readFileSync(path.join(templatesDir, 'docs/AGENTS.template.md'), 'utf8');
    const orchestrationDoc = fs.readFileSync(path.join(templatesDir, 'prompts/ORCHESTRATION.md'), 'utf8');

    expect(agentsTemplate).toContain('actions/workflows/trigger-autowork-manual.yml');
    expect(orchestrationDoc).toContain('trigger-autowork-manual.yml');
  });

  it('verifies trigger-review-routine.yml includes periodic scan sweep and failure notification handler', () => {
    const workflowPath = path.join(workflowsDir, 'trigger-review-routine.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toContain('schedule:');
    expect(content).toContain('cron:');
    expect(content).toContain("github.event_name == 'schedule'");
    expect(content).toContain("!startsWith(github.event.pull_request.head.ref, 'release-please--')");
    expect(content).toContain('release-please--*');
    expect(content).toContain('Handle Review Failure & PR Notification');
    expect(content).toContain('if: failure()');
    expect(content).toContain('Peer Review Routine Notice');
  });

  it('validates Upstream Ecosystem Radar workflow and evaluation matrix script covering Symphony and Funes', () => {
    const radarWorkflowPath = path.join(process.cwd(), '.github/workflows/symphony-radar.yml');
    expect(fs.existsSync(radarWorkflowPath)).toBe(true);
    const workflowContent = fs.readFileSync(radarWorkflowPath, 'utf8');
    expect(workflowContent).toContain('Upstream Symphony Radar');
    expect(workflowContent).toContain('schedule:');
    expect(workflowContent).toContain('workflow_dispatch:');
    expect(workflowContent).toContain('fetch-symphony-radar.js');

    const radarScriptPath = path.join(process.cwd(), '.github/scripts/fetch-symphony-radar.js');
    expect(fs.existsSync(radarScriptPath)).toBe(true);
    const scriptContent = fs.readFileSync(radarScriptPath, 'utf8');
    expect(scriptContent).toContain('openai/symphony');
    expect(scriptContent).toContain('huggingface/funes');
    expect(scriptContent).toContain('Upstream Orchestration Watch');
    expect(scriptContent).toContain('Upstream Agent Memory Watch');
    expect(scriptContent).toContain('Upstream Architectural Evaluation Matrix');
    expect(scriptContent).toContain('Agent Memory & Session Indexing Evaluation (Funes Integration)');
    expect(scriptContent).toContain('Zero-Daemon Invariant');
    expect(scriptContent).toContain('Issue Tracker Abstraction');
    expect(scriptContent).toContain('Token & Cost Economy');
    expect(scriptContent).toContain('Multi-Repo Portability');
    expect(scriptContent).toContain('Zero-LLM Ingestion');
    expect(scriptContent).toContain('Pull-Based Memory Delivery');
    expect(scriptContent).toContain('Category A');
    expect(scriptContent).toContain('Category B');
    expect(scriptContent).toContain('Category C');
  });

  it('validates NOTICE file and Symphony attribution in documentation', () => {
    const noticePath = path.join(process.cwd(), 'NOTICE');
    expect(fs.existsSync(noticePath)).toBe(true);
    const noticeContent = fs.readFileSync(noticePath, 'utf8');
    expect(noticeContent).toContain('OpenAI Symphony');
    expect(noticeContent).toContain('Apache License, Version 2.0');
    expect(noticeContent).toContain('Single-flight issue claiming');

    const orchestrationDoc = fs.readFileSync(path.join(templatesDir, 'prompts/ORCHESTRATION.md'), 'utf8');
    expect(orchestrationDoc).toContain('Upstream Symphony, Funes & Orbital Intel & Architectural Evaluation Framework');
    expect(orchestrationDoc).toContain('Layer 1 (Zero-Daemon Invariant)');
    expect(orchestrationDoc).toContain('Agent Memory & Session Indexing Evaluation Dimensions');
    expect(orchestrationDoc).toContain('Project Agent & Worker Transports Evaluation Dimensions');
  });

  it('ensures trigger workflows define concurrency at the job level to prevent self-cancellation on skipped triggers', () => {
    const triggerWorkflows = [
      { file: 'trigger-review-routine.yml', job: 'trigger-routine' },
      { file: 'trigger-autowork-on-bug.yml', job: 'fire-autowork' },
      { file: 'trigger-autowork-on-merge.yml', job: 'fire-autowork' },
    ];

    for (const { file, job } of triggerWorkflows) {
      const templatePath = path.join(workflowsDir, file);
      const githubPath = path.join(process.cwd(), '.github/workflows', file);

      for (const filePath of [templatePath, githubPath]) {
        expect(fs.existsSync(filePath)).toBe(true);
        const content = fs.readFileSync(filePath, 'utf8');

        // Verify top-level concurrency is absent (it should not start at column 0)
        expect(content).not.toMatch(/^concurrency:/m);

        // Verify concurrency is nested under the specific job
        expect(content).toContain(`  ${job}:`);
        expect(content).toMatch(new RegExp(`  ${job}:[\\s\\S]*?    concurrency:[\\s\\S]*?      cancel-in-progress: true`));
      }

      // Ensure exact byte-for-byte 1:1 parity between template and .github workflow
      const templateContent = fs.readFileSync(templatePath, 'utf8');
      const githubContent = fs.readFileSync(githubPath, 'utf8');
      expect(templateContent).toBe(githubContent);
    }
  });

  it('ensures all workflow YAML files in templates and .github parse without syntax errors', () => {
    const dirs = [workflowsDir, path.join(process.cwd(), '.github/workflows')];
    for (const dir of dirs) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      for (const file of files) {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        expect(() => parse(content)).not.toThrow();
      }
    }
  });

  it('ensures run-with-loop-guard.js execution script exists in .github/scripts and templates/scripts with byte-for-byte parity', () => {
    const scriptGithub = path.join(process.cwd(), '.github/scripts/run-with-loop-guard.js');
    const scriptTemplate = path.join(templatesDir, 'scripts/run-with-loop-guard.js');

    expect(fs.existsSync(scriptGithub)).toBe(true);
    expect(fs.existsSync(scriptTemplate)).toBe(true);

    const githubScriptContent = fs.readFileSync(scriptGithub, 'utf8');
    const templateScriptContent = fs.readFileSync(scriptTemplate, 'utf8');
    expect(githubScriptContent).toBe(templateScriptContent);
    expect(githubScriptContent).toContain('class LoopGuard');
    expect(githubScriptContent).toContain('repetitionThreshold');
    expect(githubScriptContent).toContain('pingPongThreshold');
    expect(githubScriptContent).toContain('consecutiveErrorThreshold');
    expect(githubScriptContent).toContain('loop_circuit_breaker');
  });

  it('ensures all routine workflows implement graceful quota-pause handling', () => {
    const routineWorkflows = [
      'autowork-cron.yml',
      'dependency-check-cron.yml',
      'issues-housekeeping-cron.yml',
      'prompt-optimizer-cron.yml',
      'trigger-autowork-manual.yml',
      'trigger-autowork-on-bug.yml',
      'trigger-autowork-on-merge.yml',
      'trigger-review-routine.yml',
      'analytics-review-cron.yml',
      'design-review-cron.yml',
    ];

    for (const file of routineWorkflows) {
      const templatePath = path.join(workflowsDir, file);
      expect(fs.existsSync(templatePath), `Template ${file} should exist`).toBe(true);
      const content = fs.readFileSync(templatePath, 'utf8');

      expect(content).toContain('Individual quota reached|quota reached');
      expect(content).toContain('QUOTA_PAUSED=true');
      expect(content).toContain('status:quota-paused');
      expect(content).toContain('Milestone: Routine Execution Quota-Paused');
    }
  });

  it('verifies detectQuotaExceeded parses reset timeline correctly', async () => {
    const { detectQuotaExceeded } = await import('../src/lib/runner.js');

    const quotaError = 'Error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 33m45s.';
    const res1 = detectQuotaExceeded('', quotaError);
    expect(res1.isQuota).toBe(true);
    expect(res1.resetInfo).toBe('Resets in 33m45s');

    const res2 = detectQuotaExceeded(quotaError, '');
    expect(res2.isQuota).toBe(true);
    expect(res2.resetInfo).toBe('Resets in 33m45s');

    const normalError = 'Error: Command failed with exit code 1';
    const res3 = detectQuotaExceeded('', normalError);
    expect(res3.isQuota).toBe(false);
    expect(res3.resetInfo).toBeUndefined();
  });
});


