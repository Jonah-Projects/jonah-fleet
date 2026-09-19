import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTemplatesDir } from "../src/lib/installer.js";

describe("3-Tier Prompt Prefix Caching Architecture & Invariants", () => {
  const templatesDir = getTemplatesDir();
  const promptsDir = path.join(templatesDir, "prompts");
  const githubPromptsDir = path.resolve(process.cwd(), ".github", "prompts");

  const routinePromptFiles = [
    "autowork.md",
    "peer-review.md",
    "optimizer.md",
    "issues-housekeeping.md",
    "dependency-update-security-check.md",
    "product-planning.md",
    "analytics-review.md",
    "design-review.md",
  ];

  it("validates _prompt-template.md comprehensively documents the 3-tier prompt prefix-caching architecture", () => {
    const templatePath = path.join(promptsDir, "_prompt-template.md");
    expect(fs.existsSync(templatePath)).toBe(true);

    const content = fs.readFileSync(templatePath, "utf8");

    // Must document 3-tier architecture inspired by Orbital
    expect(content).toMatch(/3-Tier Prompt Prefix Caching|3-tier.*prefix.*caching/i);
    expect(content).toMatch(/Orbital/i);
    expect(content).toMatch(/cache hit/i);

    // Must document all 3 tiers with descriptions
    expect(content).toMatch(/Tier 1.*Static Invariant Prefix/i);
    expect(content).toMatch(/Tier 2.*Semi-Stable Project Rules/i);
    expect(content).toMatch(/Tier 3.*Dynamic Tail Payload/i);

    // Must emphasize static prefix placement and dynamic tail payload
    expect(content).toMatch(/tail/i);
  });

  it.each(routinePromptFiles)(
    "validates %s enforces strict 3-tier sequential ordering (Tier 1 -> Tier 2 -> Tier 3)",
    (filename) => {
      const filePath = path.join(promptsDir, filename);
      const content = fs.readFileSync(filePath, "utf8");

      // Verify Tier 1, Tier 2, and Tier 3 markers/headings are present
      const tier1Regex = /(?:<!--\s*TIER 1|## .*Tier 1|Tier 1:)/i;
      const tier2Regex = /(?:<!--\s*TIER 2|## .*Tier 2|Tier 2:)/i;
      const tier3Regex = /(?:<!--\s*TIER 3|## .*Tier 3|Tier 3:)/i;

      const tier1Match = content.match(tier1Regex);
      const tier2Match = content.match(tier2Regex);
      const tier3Match = content.match(tier3Regex);

      expect(tier1Match, `${filename} must define Tier 1 (Static Invariant Prefix)`).not.toBeNull();
      expect(tier2Match, `${filename} must define Tier 2 (Semi-Stable Project Rules)`).not.toBeNull();
      expect(tier3Match, `${filename} must define Tier 3 (Dynamic Tail Payload)`).not.toBeNull();

      const tier1Index = tier1Match!.index!;
      const tier2Index = tier2Match!.index!;
      const tier3Index = tier3Match!.index!;

      // Verify strict sequential ordering: Tier 1 < Tier 2 < Tier 3
      expect(tier1Index).toBeLessThan(tier2Index);
      expect(tier2Index).toBeLessThan(tier3Index);

      // Verify Tier 1 contains core invariant sections
      const tier1Content = content.slice(tier1Index, tier2Index);
      expect(tier1Content).toContain("## Objective");
      expect(tier1Content).toContain("## Definition of Done");
      expect(tier1Content).toContain("## Constraints");
      expect(tier1Content).toContain("## Instructions");
      expect(tier1Content).toContain("## Logging");

      // Verify Tier 2 references semi-stable project sources: AGENTS.md, manifest, LESSONS.md
      const tier2Content = content.slice(tier2Index, tier3Index);
      expect(tier2Content).toMatch(/AGENTS\.md/i);

      // Verify Tier 3 is positioned at the tail and defines dynamic context
      const tier3Content = content.slice(tier3Index);
      expect(tier3Content).toMatch(/payload|dynamic|target/i);
    }
  );

  it.each(routinePromptFiles)(
    "ensures no dynamic interpolation tokens or variables exist in Tier 1 or Tier 2 of %s",
    (filename) => {
      const filePath = path.join(promptsDir, filename);
      const content = fs.readFileSync(filePath, "utf8");

      const tier3Regex = /(?:<!--\s*TIER 3|## .*Tier 3|Tier 3:)/i;
      const tier3Match = content.match(tier3Regex);
      expect(tier3Match).not.toBeNull();

      // Static prefix spans everything before Tier 3
      const staticPrefix = content.slice(0, tier3Match!.index!);

      // Must not have curly brace dynamic interpolation tags like {{ TARGET_ISSUE }}
      expect(staticPrefix).not.toMatch(/\{\{\s*[A-Z_]+\s*\}\}/);

      // Must not have raw injected ISO timestamp literals (e.g. 2026-09-19T...)
      expect(staticPrefix).not.toMatch(/202[0-9]-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/);
    }
  );

  it("validates ORCHESTRATION.md details the 3-tier prefix-caching architecture and caching hit rate goals", () => {
    const orchestrationPath = path.join(promptsDir, "ORCHESTRATION.md");
    const content = fs.readFileSync(orchestrationPath, "utf8");

    expect(content).toMatch(/3-Tier Prompt Prefix Caching|Prompt Prefix Caching/i);
    expect(content).toMatch(/Static.*Semi-Stable.*Dynamic/);
    expect(content).toMatch(/90%|95%/);
    expect(content).toMatch(/Tier 1/);
    expect(content).toMatch(/Tier 2/);
    expect(content).toMatch(/Tier 3/);
  });

  it("ensures prompt templates in templates/prompts are strictly synchronized with .github/prompts", () => {
    expect(fs.existsSync(githubPromptsDir)).toBe(true);

    for (const filename of fs.readdirSync(promptsDir)) {
      const templatePath = path.join(promptsDir, filename);
      const githubPath = path.join(githubPromptsDir, filename);
      if (fs.existsSync(githubPath)) {
        const templateContent = fs.readFileSync(templatePath, "utf8");
        const githubContent = fs.readFileSync(githubPath, "utf8");
        expect(
          githubContent,
          `Prompt ${filename} in .github/prompts does not match templates/prompts/${filename}`
        ).toBe(templateContent);
      }
    }
  });
});
