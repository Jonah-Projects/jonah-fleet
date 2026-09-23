import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Release Configuration & Manifests', () => {
  const rootDir = process.cwd();

  it('validates release-please-config.json structure', () => {
    const configPath = path.join(rootDir, 'release-please-config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.packages).toBeDefined();
    expect(config.packages['.']).toBeDefined();
    expect(config.packages['.']['release-type']).toBe('node');
    expect(config.packages['.']['package-name']).toBe('jonah-fleet');
    expect(config.packages['.']['changelog-path']).toBe('CHANGELOG.md');
    expect(config.packages['.']['include-component-in-tag']).toBe(false);
    expect(config.packages['.']['extra-files']).toContain('agents-manifest.json');
  });

  it('validates .release-please-manifest.json and agents-manifest.json align with package.json version', () => {
    const manifestPath = path.join(rootDir, '.release-please-manifest.json');
    const agentsManifestPath = path.join(rootDir, 'agents-manifest.json');
    const packageJsonPath = path.join(rootDir, 'package.json');

    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(agentsManifestPath)).toBe(true);
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentsManifest = JSON.parse(fs.readFileSync(agentsManifestPath, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(manifest['.']).toBe(pkg.version);
    expect(agentsManifest.version).toBe(pkg.version);
  });

  it('validates .github/workflows/release-please.yml workflow configuration', () => {
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'release-please.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);

    const workflowContent = fs.readFileSync(workflowPath, 'utf8');
    expect(workflowContent).toMatch(/token:\s*\${{\s*steps\.app-token\.outputs\.token\s*\|\|\s*secrets\.GH_PAT\s*\|\|\s*github\.token\s*}}/);
    expect(workflowContent).toContain('actions/create-github-app-token');
    expect(workflowContent).not.toMatch(/if:\s*.*secrets\./);
    expect(workflowContent).toContain('contents: write');
    expect(workflowContent).toContain('pull-requests: write');
    expect(workflowContent).toContain('issues: write');
    expect(workflowContent).toContain('gh pr merge "$PR_NUMBER" --auto --squash');
  });

  it('validates .github/workflows/release.yml publication workflow configuration', () => {
    const workflowPath = path.join(rootDir, '.github', 'workflows', 'release.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);

    const workflowContent = fs.readFileSync(workflowPath, 'utf8');
    expect(workflowContent).toContain("push:\n    tags:\n      - 'v*'\n      - 'jonah-fleet-v*'");
    expect(workflowContent).toContain('id-token: write');
    expect(workflowContent).toContain('npm publish --provenance --access public');
  });
});
