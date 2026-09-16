import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTemplatesDir } from "../src/lib/installer.js";

describe("Prompt Validation & Invariants", () => {
  const templatesDir = getTemplatesDir();
  const promptsDir = path.join(templatesDir, "prompts");
  const promptFiles = fs
    .readdirSync(promptsDir)
    .filter((f) => f.endsWith(".md") && f !== "ORCHESTRATION.md");

  it.each(promptFiles)("validates structure for %s", (filename) => {
    const filePath = path.join(promptsDir, filename);
    const content = fs.readFileSync(filePath, "utf8");

    expect(content).toContain("## Objective");
    expect(content).toContain("## Definition of Done");
    expect(content).toContain("## Constraints");
    expect(content).toContain("## Instructions");
    expect(content).toContain("## Logging");
  });

  it("ensures no hardcoded repo names or credentials exist in prompt templates", () => {
    for (const filename of fs.readdirSync(promptsDir)) {
      const filePath = path.join(promptsDir, filename);
      const content = fs.readFileSync(filePath, "utf8");

      // Check for hardcoded project references that shouldn't be in generic templates
      expect(content).not.toContain("Jonah-RuPaul/src");
      expect(content).not.toContain("jonah-newsletter-gemini");
    }
  });

  it("validates optimizer.md contains per-agent token aggregation protocol and scorecard schema", () => {
    const templatePath = path.join(promptsDir, "optimizer.md");
    const content = fs.readFileSync(templatePath, "utf8");

    // Instructions Step 1 - Token aggregation
    expect(content).toContain("Token & Cost Consumption by Agent");
    expect(content).toContain("autowork");
    expect(content).toContain("peer-review");
    expect(content).toContain("issues-housekeeping");
    expect(content).toContain("dependency-update-security-check");
    expect(content).toContain("optimizer");
    expect(content).toContain("product-planning");
    expect(content).toContain("70%");
    expect(content).toContain("ORCHESTRATION.md");

    // Scorecard table in logging section
    expect(content).toMatch(
      /\| *Routine *\| *Runs *\| *Input Tokens *\| *Output Tokens *\| *Total Tokens *\| *Cost *\| *Fleet % *\| *Avg Iterations *\| *Max Iterations *\| *Status \/ Anomaly *\|/,
    );
  });

  it("validates optimizer.md defines concrete token anomaly heuristics and preventative remediation actions", () => {
    const optimizerPath = path.join(promptsDir, "optimizer.md");
    const content = fs.readFileSync(optimizerPath, "utf8");

    // Token Anomaly Heuristics
    expect(content).toContain("Token Surge");
    expect(content).toMatch(/Token Surge.*>50%/s);
    expect(content).toContain("Budget Hog");
    expect(content).toMatch(/Budget Hog.*>75%/s);
    expect(content).toContain("Iteration Ceiling Exhaustion");
    expect(content).toMatch(/Iteration Ceiling Exhaustion.*>20%/s);
    expect(content).toContain("Review Loop Burn");
    expect(content).toMatch(/Review Loop Burn.*(?:≥|>=)\s*3/s);
    expect(content).toContain("Feedback Loop Stagnation");
    expect(content).toContain(
      'Passive Order-Taking Anomaly ("Yes-Man Blindspot")',
    );
    expect(content).toContain("Speculative Runaway Waste");

    // Automated preventative actions
    expect(content).toMatch(
      /pruning redundant instructions|instruction pruning/i,
    );
    expect(content).toMatch(/early exit|candidate skip/i);
    expect(content).toMatch(/iteration ceiling|pre-ready self-audit/i);
    expect(content).toMatch(
      /loop discovery mechanical audits|deterministic per-issue matching/i,
    );
    expect(content).toContain("Ambiguity Gate & Benchmark Eval Feeding");
  });

  it("validates ORCHESTRATION.md documents the token anomaly triage and remediation workflow", () => {
    const orchestrationPath = path.join(
      templatesDir,
      "prompts",
      "ORCHESTRATION.md",
    );
    const content = fs.readFileSync(orchestrationPath, "utf8");

    expect(content).toContain("## Token Anomaly Triage & Remediation");
    expect(content).toContain("Token Surge");
    expect(content).toContain("Budget Hog");
    expect(content).toContain("Iteration Ceiling Exhaustion");
    expect(content).toContain("Review Loop Burn");
    expect(content).toContain("Feedback Loop Stagnation");
    expect(content).toContain(
      'Passive Order-Taking Anomaly ("Yes-Man Blindspot")',
    );
    expect(content).toContain("Speculative Runaway Waste");
  });

  it("validates peer-review.md and ORCHESTRATION.md define the Autonomous Issue Synthesis protocol", () => {
    const peerReviewPath = path.join(promptsDir, "peer-review.md");
    const orchestrationPath = path.join(
      templatesDir,
      "prompts",
      "ORCHESTRATION.md",
    );
    const peerReviewContent = fs.readFileSync(peerReviewPath, "utf8");
    const orchestrationContent = fs.readFileSync(orchestrationPath, "utf8");

    expect(peerReviewContent).toContain("Autonomous Issue Synthesis");
    expect(peerReviewContent).toContain("gh issue create");
    expect(peerReviewContent).toContain("gh pr edit");
    expect(orchestrationContent).toContain("## Autonomous Issue Synthesis");
  });

  it("validates peer-review.md and autowork.md enforce tracking issue closure and reference guardrails", () => {
    const peerReviewPath = path.join(promptsDir, "peer-review.md");
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const peerReviewContent = fs.readFileSync(peerReviewPath, "utf8");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");

    // peer-review explicit closure guardrail
    expect(peerReviewContent).toContain(
      "Explicit Tracking Issue Closure Guardrail",
    );
    expect(peerReviewContent).toContain('gh issue close "$ISSUE_NUMBER"');

    // autowork issue reference comment guardrail & convergence sweep
    expect(autoworkContent).toContain(
      "Issue Cross-Reference Comment Guardrail",
    );
    expect(autoworkContent).toContain(
      'gh issue comment <ISSUE_NUMBER> --body "Work in progress in PR #<PR_NUMBER>."',
    );
    expect(autoworkContent).toContain('git log -n 50 --grep="#<ISSUE_NUMBER>"');
  });

  it("validates ORCHESTRATION.md, autowork.md, peer-review.md, and optimizer.md define Routine Progress Reporting and Compact Milestone Cards", () => {
    const orchestrationPath = path.join(templatesDir, "prompts", "ORCHESTRATION.md");
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const peerReviewPath = path.join(promptsDir, "peer-review.md");
    const optimizerPath = path.join(promptsDir, "optimizer.md");

    const orchestrationContent = fs.readFileSync(orchestrationPath, "utf8");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    const peerReviewContent = fs.readFileSync(peerReviewPath, "utf8");
    const optimizerContent = fs.readFileSync(optimizerPath, "utf8");

    // ORCHESTRATION.md protocol definition
    expect(orchestrationContent).toContain("Routine Issue Progress Reporting & Milestone Protocol");
    expect(orchestrationContent).toContain("Compact Milestone Cards");
    expect(orchestrationContent).toContain('gh issue comment "$ROUTINE_ISSUE_NUMBER"');

    // autowork.md milestones
    expect(autoworkContent).toContain("Milestone: Intake & Strategy");
    expect(autoworkContent).toContain("Milestone: Verification & Tests");
    expect(autoworkContent).toContain("Milestone: Autonomous Handoff");
    expect(autoworkContent).toContain("Milestone: Run Completed");

    // peer-review.md milestones
    expect(peerReviewContent).toContain("Milestone: Intake & Review Scope");
    expect(peerReviewContent).toContain("Milestone: Run Completed");

    // optimizer.md milestones
    expect(optimizerContent).toContain("Milestone: Intake & Fleet Telemetry Scan");
    expect(optimizerContent).toContain("Milestone: Run Completed");
  });

  it("validates trigger-review-routine.yml supports workflow_dispatch, issue_comment, and review_requested triggers", () => {
    const workflowPath = path.join(
      templatesDir,
      "workflows",
      "trigger-review-routine.yml",
    );
    const content = fs.readFileSync(workflowPath, "utf8");

    expect(content).toContain("workflow_dispatch:");
    expect(content).toContain("pr_number:");
    expect(content).toContain("issue_comment:");
    expect(content).toContain("review_requested");
    expect(content).toContain("/review");
    expect(content).toContain("/peer-review");
    expect(content).toContain("/retrigger");
    expect(content).toContain("/re-review");
    expect(content).toMatch(/github\.event_name == 'workflow_dispatch'/);
    expect(content).toMatch(/github\.event_name == 'issue_comment'/);
  });

  it("validates ORCHESTRATION.md documents manual and comment triggers for peer review", () => {
    const orchestrationPath = path.join(
      templatesDir,
      "prompts",
      "ORCHESTRATION.md",
    );
    const content = fs.readFileSync(orchestrationPath, "utf8");

    expect(content).toContain("trigger-review-routine.yml");
    expect(content).toContain("workflow_dispatch");
    expect(content).toContain("/review");
    expect(content).toContain("/peer-review");
  });

  it("validates ORCHESTRATION.md, autowork.md, and peer-review.md define the Peer Review Resilience & Orphaned PR Recovery protocol", () => {
    const orchestrationPath = path.join(
      templatesDir,
      "prompts",
      "ORCHESTRATION.md",
    );
    const autoworkPath = path.join(templatesDir, "prompts", "autowork.md");
    const peerReviewPath = path.join(templatesDir, "prompts", "peer-review.md");

    const orchestrationContent = fs.readFileSync(orchestrationPath, "utf8");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    const peerReviewContent = fs.readFileSync(peerReviewPath, "utf8");

    expect(orchestrationContent).toContain(
      "## Peer Review Resilience & Orphaned PR Recovery",
    );
    expect(orchestrationContent).toContain("Failure Trapping & Transparency");
    expect(orchestrationContent).toContain("Periodic Scan Sweep (Watchdog)");
    expect(orchestrationContent).toContain("Autowork Phase 1 Watchdog");

    expect(autoworkContent).toContain("Orphaned Ready PR Recovery");
    expect(peerReviewContent).toContain(
      "Category B (first review / unreviewed)",
    );
  });

  it("validates analytics-review.md defines mandatory post-measurement action directives and product planning bridge", () => {
    const templatePath = path.join(promptsDir, "analytics-review.md");
    expect(fs.existsSync(templatePath)).toBe(true);

    const content = fs.readFileSync(templatePath, "utf8");
    expect(content).toContain("## Objective");
    expect(content).toContain("## Definition of Done");
    expect(content).toContain("## Constraints");
    expect(content).toContain("## Instructions");
    expect(content).toContain("## Logging");
    expect(content).toContain("RECOMMENDATION:");
    expect(content).toMatch(
      /RECOMMENDATION:.*\[PIVOT \| DEPRECATE \| ITERATE\]/,
    );
    expect(content).toContain("🗺️ Product Plan");
    expect(content).toContain("product-planning");
  });

  it("validates product-planning.md contains feature pruning and deprecation audit in Propose mode", () => {
    const templatePath = path.join(promptsDir, "product-planning.md");
    const content = fs.readFileSync(templatePath, "utf8");

    expect(content).toMatch(/pruning|deprecation/i);
    expect(content).toMatch(/<2%/);
    expect(content).toMatch(/>50%/);
    expect(content).toContain("RECOMMENDATION:");
  });

  it("validates autowork.md and diagnosing-bugs contain Intent vs. Defect Guardrail to prevent telemetry rabbit holes", () => {
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    expect(autoworkContent).toContain("Intent vs. Defect Guardrail");
    expect(autoworkContent).toMatch(/telemetry rabbit hole/i);
    expect(autoworkContent).toMatch(/needs-design|roadmap\/\*/);

    const diagnosingBugsPath = path.join(
      templatesDir,
      "skills",
      "diagnosing-bugs",
      "SKILL.md",
    );
    const diagnosingBugsContent = fs.readFileSync(diagnosingBugsPath, "utf8");
    expect(diagnosingBugsContent).toContain("Intent vs. Defect Guardrail");
    expect(diagnosingBugsContent).toMatch(/telemetry rabbit hole/i);
  });

  it("validates ORCHESTRATION.md documents the Post-Measurement Product Bridge and Intent vs. Defect Guardrail", () => {
    const orchestrationPath = path.join(
      templatesDir,
      "prompts",
      "ORCHESTRATION.md",
    );
    const content = fs.readFileSync(orchestrationPath, "utf8");

    expect(content).toContain("Post-Measurement Product Bridge");
    expect(content).toContain("Intent vs. Defect Guardrail");
    expect(content).toContain("RECOMMENDATION: [PIVOT | DEPRECATE | ITERATE]");
  });

  it("validates peer-review.md, autowork.md, and analytics-review.md define Design System & Telemetry Friction Guardrails", () => {
    const peerReviewPath = path.join(promptsDir, "peer-review.md");
    const peerReviewContent = fs.readFileSync(peerReviewPath, "utf8");
    expect(peerReviewContent).toContain(
      "Design System & Viewport Density Pass",
    );
    expect(peerReviewContent).toContain("Token Purity");
    expect(peerReviewContent).toContain("WCAG AA Contrast");
    expect(peerReviewContent).toContain("CTA Hierarchy");
    expect(peerReviewContent).toContain("Mobile Viewport Budget");

    const autoworkPath = path.join(promptsDir, "autowork.md");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    expect(autoworkContent).toContain("Design System & Viewport Pre-flight");
    expect(autoworkContent).toMatch(/WCAG AA/i);
    expect(autoworkContent).toMatch(/design tokens/i);

    const analyticsPath = path.join(promptsDir, "analytics-review.md");
    const analyticsContent = fs.readFileSync(analyticsPath, "utf8");
    expect(analyticsContent).toContain("UI Friction & Nudge Fatigue Guardrail");
    expect(analyticsContent).toMatch(/\$rageclick/i);
    expect(analyticsContent).toMatch(/500 impressions/i);
    expect(analyticsContent).toMatch(/< 2\.0%|<2%/);
  });

  it("validates AGENTS.template.md and AGENTS.md document Design System & UI Guardrails", () => {
    const templateDocPath = path.join(
      templatesDir,
      "docs",
      "AGENTS.template.md",
    );
    const templateDocContent = fs.readFileSync(templateDocPath, "utf8");
    expect(templateDocContent).toContain("Design System & UI Guardrails");
    expect(templateDocContent).toContain("Design Token Purity");
    expect(templateDocContent).toContain("Accessibility & Contrast");
    expect(templateDocContent).toContain("CTA & Visual Hierarchy");
    expect(templateDocContent).toContain("Viewport Density & Nudge Budget");

    const agentsPath = path.resolve(process.cwd(), "AGENTS.md");
    const agentsContent = fs.readFileSync(agentsPath, "utf8");
    expect(agentsContent).toContain("Design System & UI Guardrails");
  });

  it("validates AGENTS.template.md and AGENTS.md document Requirements Discovery & Inquisitive Stance", () => {
    const templateDocPath = path.join(
      templatesDir,
      "docs",
      "AGENTS.template.md",
    );
    const templateDocContent = fs.readFileSync(templateDocPath, "utf8");
    expect(templateDocContent).toContain(
      "Requirements Discovery & Inquisitive Stance",
    );
    expect(templateDocContent).toContain("Challenge Premise First");
    expect(templateDocContent).toContain("Zero-Guesswork Ambiguity Gate");
    expect(templateDocContent).toContain("/grill-me");

    const agentsPath = path.resolve(process.cwd(), "AGENTS.md");
    const agentsContent = fs.readFileSync(agentsPath, "utf8");
    expect(agentsContent).toContain(
      "Requirements Discovery & Inquisitive Stance",
    );
    expect(agentsContent).toContain("Challenge Premise First");
    expect(agentsContent).toContain("Zero-Guesswork Ambiguity Gate");
    expect(agentsContent).toContain("/grill-me");
  });

  it("validates autowork.md defines Ambiguity & Missing Acceptance Criteria Gate and needs-info", () => {
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    expect(autoworkContent).toContain(
      "Ambiguity & Missing Acceptance Criteria Gate",
    );
    expect(autoworkContent).toContain("needs-info");
    expect(autoworkContent).toMatch(
      /Do not guess or invent arbitrary specifications for ambiguous issues/,
    );
  });

  it("validates autowork.md guards Orphaned Ready PR Recovery with Passing CI Verification Gate", () => {
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    expect(autoworkContent).toContain("Orphaned Ready PR Recovery");
    expect(autoworkContent).toContain("Passing CI Verification Gate");
    expect(autoworkContent).toContain("Unapproved/Pending Workflow Invariant");
    expect(autoworkContent).toContain("ACTION_REQUIRED");

    const orchestrationPath = path.join(promptsDir, "ORCHESTRATION.md");
    const orchestrationContent = fs.readFileSync(orchestrationPath, "utf8");
    expect(orchestrationContent).toContain("Autowork Phase 1 Watchdog");
    expect(orchestrationContent).toContain("ACTION_REQUIRED");
  });

  it("validates grill-me skill exists and defines rigorous interrogation phases", () => {
    const grillSkillPath = path.join(
      templatesDir,
      "skills",
      "grill-me",
      "SKILL.md",
    );
    expect(fs.existsSync(grillSkillPath)).toBe(true);
    const grillContent = fs.readFileSync(grillSkillPath, "utf8");
    expect(grillContent).toContain("name: grill-me");
    expect(grillContent).toContain("Challenge the Premise & Scope");
    expect(grillContent).toContain(
      "Stress-Test Technical Seams & Failure Modes",
    );
    expect(grillContent).toContain("Establish Concrete Acceptance Criteria");
    expect(grillContent).toContain("Completion Criteria");
  });

  it("validates autowork.md and ORCHESTRATION.md define the single-flight PR Claim Protocol in Phase 1", () => {
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const orchestrationPath = path.join(
      templatesDir,
      "prompts",
      "ORCHESTRATION.md",
    );
    const autoworkContent = fs.readFileSync(autoworkPath, "utf8");
    const orchestrationContent = fs.readFileSync(orchestrationPath, "utf8");

    // Autowork constraints & DoD
    expect(autoworkContent).toContain("Single-flight per issue & PR");
    expect(autoworkContent).toContain("PR Claim Protocol");
    expect(autoworkContent).toContain(
      "🔒 Addressing review findings by autowork run",
    );
    expect(autoworkContent).toContain(
      "🔒 Addressing review findings by local autowork session",
    );
    expect(autoworkContent).toContain("Warm Context Assignment");

    // ORCHESTRATION.md invariant and stale claim definition
    expect(orchestrationContent).toContain(
      "Single-flight per issue and PR convergence",
    );
    expect(orchestrationContent).toContain(
      "## PR Stale-Claim Definition (Phase 1 Convergence)",
    );
    expect(orchestrationContent).toMatch(/more than 2 hours/i);
  });

  it("ensures prompt templates in templates/prompts are strictly synchronized with .github/prompts", () => {
    const githubPromptsDir = path.resolve(process.cwd(), ".github", "prompts");
    expect(fs.existsSync(githubPromptsDir)).toBe(true);

    for (const filename of fs.readdirSync(promptsDir)) {
      const templatePath = path.join(promptsDir, filename);
      const githubPath = path.join(githubPromptsDir, filename);
      if (fs.existsSync(githubPath)) {
        const templateContent = fs.readFileSync(templatePath, "utf8");
        const githubContent = fs.readFileSync(githubPath, "utf8");
        expect(githubContent).toBe(templateContent);
      }
    }
  });

  it("validates Routine Issue Logging Protocol & Invariants in autowork.md, _prompt-template.md, and ORCHESTRATION.md", () => {
    const autoworkContent = fs.readFileSync(
      path.join(promptsDir, "autowork.md"),
      "utf8",
    );
    expect(autoworkContent).toContain("Issue Logging Protocol & Invariants");
    expect(autoworkContent).toContain(
      "NEVER commit or push run logs to any git branch",
    );
    expect(autoworkContent).toContain("ROUTINE_ISSUE_NUMBER");

    const templateContent = fs.readFileSync(
      path.join(promptsDir, "_prompt-template.md"),
      "utf8",
    );
    expect(templateContent).toContain("Issue Logging Protocol & Invariants");
    expect(templateContent).toContain(
      "NEVER commit or push run logs to any git branch",
    );
    expect(templateContent).toContain("ROUTINE_ISSUE_NUMBER");

    const orchestrationContent = fs.readFileSync(
      path.join(promptsDir, "ORCHESTRATION.md"),
      "utf8",
    );
    expect(orchestrationContent).toContain(
      "## Routine Issue Logging & Telemetry Protocol",
    );
    expect(orchestrationContent).toContain(
      "GitHub Issues as Operational Ledger",
    );
    expect(orchestrationContent).toContain("status:running");
    expect(orchestrationContent).toContain("status:success");
    expect(orchestrationContent).toContain("status:failure");
  });

  it("ensures workflow templates in templates/workflows are strictly synchronized with .github/workflows", () => {
    const workflowsDir = path.join(templatesDir, "workflows");
    const githubWorkflowsDir = path.resolve(
      process.cwd(),
      ".github",
      "workflows",
    );
    expect(fs.existsSync(githubWorkflowsDir)).toBe(true);

    for (const filename of fs.readdirSync(workflowsDir)) {
      const templatePath = path.join(workflowsDir, filename);
      const githubPath = path.join(githubWorkflowsDir, filename);
      if (fs.existsSync(githubPath)) {
        const templateContent = fs.readFileSync(templatePath, "utf8");
        const githubContent = fs.readFileSync(githubPath, "utf8");
        expect(githubContent).toBe(templateContent);
      }
    }
  });

  it("validates issues-housekeeping.md delegates safe label pruning to jonah-fleet labels prune", () => {
    const housekeepingPath = path.join(promptsDir, "issues-housekeeping.md");
    const content = fs.readFileSync(housekeepingPath, "utf8");

    expect(content).toContain("Label audit & safe prune");
    expect(content).toContain("jonah-fleet labels prune");
    expect(content).toMatch(/npx --yes jonah-fleet labels prune --yes/);
  });
});
