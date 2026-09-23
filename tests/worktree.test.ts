import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  getWorktreesBaseDir,
  createWorktree,
  listActiveWorktrees,
  removeWorktree,
  cleanupStaleWorktrees,
} from '../src/lib/worktree.js';

describe('Git Worktree Isolation', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-worktree-test-'));
    execSync('git init', { cwd: tmpRepo });
    execSync('git config user.name "Test Runner"', { cwd: tmpRepo });
    execSync('git config user.email "test@example.com"', { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# Test Repo\n', 'utf8');
    execSync('git add README.md', { cwd: tmpRepo });
    execSync('git commit -m "initial commit"', { cwd: tmpRepo });
    execSync('git branch -M main', { cwd: tmpRepo });
  });

  afterEach(() => {
    try {
      execSync('git worktree prune', { cwd: tmpRepo });
    } catch {}
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('computes correct worktree base directory', () => {
    const baseDir = getWorktreesBaseDir(tmpRepo);
    expect(baseDir).toBe(path.join(tmpRepo, '.jonah-fleet', 'worktrees'));
  });

  it('creates an isolated git worktree and branch', async () => {
    const branchName = 'agent/autowork-test-1';
    const result = await createWorktree(tmpRepo, { branchName, baseRef: 'main' });

    expect(fs.existsSync(result.worktreePath)).toBe(true);
    expect(result.branchName).toBe(branchName);

    // Verify git status inside worktree
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: result.worktreePath })
      .toString()
      .trim();
    expect(currentBranch).toBe(branchName);

    // Verify worktrees listing
    const active = await listActiveWorktrees(tmpRepo);
    expect(active.length).toBe(1);
    expect(active[0].branch).toBe(branchName);
  });

  it('removes worktree cleanly', async () => {
    const branchName = 'agent/autowork-test-remove';
    const result = await createWorktree(tmpRepo, { branchName, baseRef: 'main' });
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    await removeWorktree(tmpRepo, result.worktreePath, { deleteBranch: true, branchName });
    expect(fs.existsSync(result.worktreePath)).toBe(false);

    const active = await listActiveWorktrees(tmpRepo);
    expect(active.length).toBe(0);
  });

  it('prunes stale worktree directories', async () => {
    const baseDir = getWorktreesBaseDir(tmpRepo);
    fs.mkdirSync(baseDir, { recursive: true });
    const staleDir = path.join(baseDir, 'orphan-dir');
    fs.mkdirSync(staleDir, { recursive: true });

    expect(fs.existsSync(staleDir)).toBe(true);
    const cleaned = await cleanupStaleWorktrees(tmpRepo);
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(staleDir)).toBe(false);
  });

  it('cleans up registered stale worktrees in .jonah-fleet/worktrees when keepPath is omitted', async () => {
    const branchName = 'agent/autowork-stale-abandoned';
    const result = await createWorktree(tmpRepo, { branchName, baseRef: 'main' });
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    const activeBefore = await listActiveWorktrees(tmpRepo);
    expect(activeBefore.length).toBe(1);

    const cleaned = await cleanupStaleWorktrees(tmpRepo);
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(result.worktreePath)).toBe(false);

    const activeAfter = await listActiveWorktrees(tmpRepo);
    expect(activeAfter.length).toBe(0);
  });
});

