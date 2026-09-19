import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTemplatesDir } from "../src/lib/installer.js";

describe("Operational Lessons (LESSONS.md) & Prompt Integration", () => {
  const templatesDir = getTemplatesDir();
  const promptsDir = path.join(templatesDir, "prompts");

  it("validates templates/docs/LESSONS.template.md exists and conforms to schema and 25-entry cap", () => {
    const lessonTemplatePath = path.join(templatesDir, "docs", "LESSONS.template.md");
    expect(fs.existsSync(lessonTemplatePath)).toBe(true);

    const content = fs.readFileSync(lessonTemplatePath, "utf8");
    expect(content).toContain("# Operational Lessons & Repository Heuristics");
    expect(content).toMatch(/Max 25 entries/i);
    expect(content).toMatch(/Hard cap/i);
    expect(content).toContain("LESSONS_ARCHIVE.md");
    expect(content).toContain("### [subsystem] Title");
    expect(content).toContain("- **Symptom:**");
    expect(content).toContain("- **Root Cause:**");
    expect(content).toContain("- **Rule:**");
  });

  it("validates schema.json allows configuring lessons in agents-manifest.json", () => {
    const schemaPath = path.resolve(process.cwd(), "schema.json");
    const schemaContent = fs.readFileSync(schemaPath, "utf8");
    const schema = JSON.parse(schemaContent);

    expect(schema.properties.lessons).toBeDefined();
  });

  it("validates autowork.md includes pre-flight memory scan, diagnostic reflex, and PR-branch capture gates", () => {
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const content = fs.readFileSync(autoworkPath, "utf8");

    // Step 12 Pre-Flight Memory Scan
    expect(content).toMatch(/Pre-Flight Memory Scan|Pre-Flight.*LESSONS\.md/i);
    expect(content).toContain('grep -E "^### \\[(subsystem)\\]" LESSONS.md -A 4');

    // Step 13 Diagnostic Reflex
    expect(content).toMatch(/Diagnostic Reflex/i);
    expect(content).toMatch(/LESSONS\.md/);

    // Step 13 Pre-PR Capture Gate
    expect(content).toMatch(/Pre-PR (?:Lessons )?Capture Gate/i);
    expect(content).toMatch(/3-line structured entry/i);
    expect(content).toMatch(/25-entry (?:hard )?cap/i);
  });

  it("validates peer-review.md includes LESSONS.md verification gate and 25-entry hard cap invariant", () => {
    const peerReviewPath = path.join(promptsDir, "peer-review.md");
    const content = fs.readFileSync(peerReviewPath, "utf8");

    expect(content).toMatch(/LESSONS\.md/);
    expect(content).toMatch(/25-entry (?:hard )?cap/i);
    expect(content).toMatch(/non-trivial/i);
  });

  it("validates optimizer.md includes LESSONS.md audit and graduation gate", () => {
    const optimizerPath = path.join(promptsDir, "optimizer.md");
    const content = fs.readFileSync(optimizerPath, "utf8");

    expect(content).toMatch(/LESSONS\.md/);
    expect(content).toMatch(/LESSONS_ARCHIVE\.md/);
    expect(content).toMatch(/graduat(?:ing|e|ion)/i);
  });
});

describe("Structured Human Escalation Card Protocol ('Why I believe this')", () => {
  const templatesDir = getTemplatesDir();
  const promptsDir = path.join(templatesDir, "prompts");
  const skillsDir = path.join(templatesDir, "skills");

  it("validates autowork.md mandates the 4-part escalation card for needs-human and needs-info", () => {
    const autoworkPath = path.join(promptsDir, "autowork.md");
    const content = fs.readFileSync(autoworkPath, "utf8");

    expect(content).toContain("## 🛑 Escalation: Human Decision Required");
    expect(content).toContain("- **Decision Needed**:");
    expect(content).toContain('- **Evidence ("Why I believe this")**:');
    expect(content).toContain("- **Evaluated Options & Trade-offs**:");
    expect(content).toContain("- **Recommended Path**:");
    expect(content).toMatch(/needs-info/);
    expect(content).toMatch(/needs-human/);
  });

  it("validates triage/SKILL.md mandates the 4-part escalation card for needs-info and human escalations", () => {
    const triagePath = path.join(skillsDir, "triage", "SKILL.md");
    const content = fs.readFileSync(triagePath, "utf8");

    expect(content).toContain("## 🛑 Escalation: Human Decision Required");
    expect(content).toContain("- **Decision Needed**:");
    expect(content).toContain('- **Evidence ("Why I believe this")**:');
    expect(content).toContain("- **Evaluated Options & Trade-offs**:");
    expect(content).toContain("- **Recommended Path**:");
    expect(content).toMatch(/needs-info/);
  });

  it("validates issues-housekeeping.md mandates the 4-part escalation card for human escalations", () => {
    const housekeepingPath = path.join(promptsDir, "issues-housekeeping.md");
    const content = fs.readFileSync(housekeepingPath, "utf8");

    expect(content).toContain("## 🛑 Escalation: Human Decision Required");
    expect(content).toContain("- **Decision Needed**:");
    expect(content).toContain('- **Evidence ("Why I believe this")**:');
    expect(content).toContain("- **Evaluated Options & Trade-offs**:");
    expect(content).toContain("- **Recommended Path**:");
  });

  it("validates peer-review.md mandates the 4-part escalation card on round 5 escalation (needs-human)", () => {
    const peerReviewPath = path.join(promptsDir, "peer-review.md");
    const content = fs.readFileSync(peerReviewPath, "utf8");

    expect(content).toContain("## 🛑 Escalation: Human Decision Required");
    expect(content).toContain("- **Decision Needed**:");
    expect(content).toContain('- **Evidence ("Why I believe this")**:');
    expect(content).toContain("- **Evaluated Options & Trade-offs**:");
    expect(content).toContain("- **Recommended Path**:");
    expect(content).toMatch(/needs-human/);
    expect(content).toMatch(/N >= 5/);
  });
});

