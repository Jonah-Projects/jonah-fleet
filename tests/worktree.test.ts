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

  it('preserves registered active worktrees when keepPath is omitted and prunes orphaned directories', async () => {
    const branchName = 'agent/autowork-active-session';
    const result = await createWorktree(tmpRepo, { branchName, baseRef: 'main' });
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    const baseDir = getWorktreesBaseDir(tmpRepo);
    const orphanDir = path.join(baseDir, 'orphan-unregistered');
    fs.mkdirSync(orphanDir, { recursive: true });

    const activeBefore = await listActiveWorktrees(tmpRepo);
    expect(activeBefore.length).toBe(1);

    const cleaned = await cleanupStaleWorktrees(tmpRepo);
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(result.worktreePath)).toBe(true);
    expect(fs.existsSync(orphanDir)).toBe(false);

    const activeAfter = await listActiveWorktrees(tmpRepo);
    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].path).toBe(path.resolve(result.worktreePath));
  });

  it('preserves designated worktree when keepPath is provided and cleans other registered worktrees', async () => {
    const branch1 = 'agent/autowork-keep';
    const wt1 = await createWorktree(tmpRepo, { branchName: branch1, baseRef: 'main' });

    const branch2 = 'agent/autowork-to-remove';
    const wt2 = await createWorktree(tmpRepo, { branchName: branch2, baseRef: 'main' });

    const baseDir = getWorktreesBaseDir(tmpRepo);
    const orphanDir = path.join(baseDir, 'orphan-dir-2');
    fs.mkdirSync(orphanDir, { recursive: true });

    const activeBefore = await listActiveWorktrees(tmpRepo);
    expect(activeBefore.length).toBe(2);

    const cleaned = await cleanupStaleWorktrees(tmpRepo, { keepPath: wt1.worktreePath });
    expect(cleaned).toBeGreaterThanOrEqual(2);

    expect(fs.existsSync(wt1.worktreePath)).toBe(true);
    expect(fs.existsSync(wt2.worktreePath)).toBe(false);
    expect(fs.existsSync(orphanDir)).toBe(false);

    const activeAfter = await listActiveWorktrees(tmpRepo);
    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].path).toBe(path.resolve(wt1.worktreePath));
  });

  it('does not match sibling directories with similar prefix like worktrees-backup', async () => {
    const wt1 = await createWorktree(tmpRepo, { branchName: 'agent/autowork-valid', baseRef: 'main' });

    const siblingDir = path.join(tmpRepo, '.jonah-fleet', 'worktrees-backup');
    fs.mkdirSync(path.dirname(siblingDir), { recursive: true });
    execSync(`git worktree add "${siblingDir}" -b test-sibling`, { cwd: tmpRepo });
    fs.writeFileSync(path.join(siblingDir, 'important.txt'), 'keep me', 'utf8');

    // Positive control: verify git itself registers siblingDir as an active worktree
    const rawWorktrees = execSync('git worktree list --porcelain', { cwd: tmpRepo }).toString();
    expect(rawWorktrees).toContain(siblingDir);

    // listActiveWorktrees must exclude siblingDir via baseDir + path.sep delimiter filter
    const active = await listActiveWorktrees(tmpRepo);
    expect(active.length).toBe(1);
    expect(active[0].path).toBe(path.resolve(wt1.worktreePath));
    expect(active.some((w) => w.path === path.resolve(siblingDir))).toBe(false);

    // cleanupStaleWorktrees with keepPath must not prune or delete siblingDir
    await cleanupStaleWorktrees(tmpRepo, { keepPath: wt1.worktreePath });
    expect(fs.existsSync(siblingDir)).toBe(true);
    expect(fs.existsSync(path.join(siblingDir, 'important.txt'))).toBe(true);
    expect(fs.existsSync(wt1.worktreePath)).toBe(true);

    // cleanupStaleWorktrees without keepPath must also preserve siblingDir
    await cleanupStaleWorktrees(tmpRepo);
    expect(fs.existsSync(siblingDir)).toBe(true);
    expect(fs.existsSync(path.join(siblingDir, 'important.txt'))).toBe(true);
  });

  it('handles ambiguous origin/main ref when local branch origin/main exists', async () => {
    // Set up a fake remote tracking branch refs/remotes/origin/main pointing to initial commit
    execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: tmpRepo });
    const remoteOriginMainCommit = execSync('git rev-parse refs/remotes/origin/main', { cwd: tmpRepo }).toString().trim();

    // Make a second commit on main so HEAD diverges from refs/remotes/origin/main
    fs.writeFileSync(path.join(tmpRepo, 'file2.txt'), 'second commit\n', 'utf8');
    execSync('git add file2.txt', { cwd: tmpRepo });
    execSync('git commit -m "second commit on main"', { cwd: tmpRepo });

    // Intentionally create a local branch named 'origin/main' pointing to HEAD
    execSync('git branch origin/main HEAD', { cwd: tmpRepo });

    // Positive control: verify that bare "origin/main" is indeed ambiguous in this repo state
    expect(() => {
      execSync(`git worktree add "${path.join(tmpRepo, 'sub')}" -b test-ambig origin/main`, {
        cwd: tmpRepo,
        stdio: 'pipe',
      });
    }).toThrow(/ambiguous/i);

    // 1. createWorktree with baseRef omitted: resolves to refs/remotes/origin/main
    const resultOmitted = await createWorktree(tmpRepo, { branchName: 'agent/test-unambiguous' });
    expect(fs.existsSync(resultOmitted.worktreePath)).toBe(true);
    const actualCommitOmitted = execSync('git rev-parse HEAD', { cwd: resultOmitted.worktreePath }).toString().trim();
    expect(actualCommitOmitted).toBe(remoteOriginMainCommit);

    // 2. createWorktree with explicit baseRef: 'origin/main': also resolves to refs/remotes/origin/main
    const resultExplicit = await createWorktree(tmpRepo, {
      branchName: 'agent/test-explicit-origin-main',
      baseRef: 'origin/main',
    });
    expect(fs.existsSync(resultExplicit.worktreePath)).toBe(true);
    const actualCommitExplicit = execSync('git rev-parse HEAD', { cwd: resultExplicit.worktreePath }).toString().trim();
    expect(actualCommitExplicit).toBe(remoteOriginMainCommit);
  });

  it('falls back cleanly to refs/heads/main when baseRef is origin/main but remote tracking branch does not exist', async () => {
    // Initial commit is on main; create a distinct commit on main
    fs.writeFileSync(path.join(tmpRepo, 'main-commit.txt'), 'main commit\n', 'utf8');
    execSync('git add main-commit.txt', { cwd: tmpRepo });
    execSync('git commit -m "distinct main commit"', { cwd: tmpRepo });
    const mainCommit = execSync('git rev-parse refs/heads/main', { cwd: tmpRepo }).toString().trim();

    // Create an older local branch named 'origin/main' pointing to initial commit (HEAD~1)
    execSync('git branch origin/main HEAD~1', { cwd: tmpRepo });
    // Note: refs/remotes/origin/main does NOT exist in tmpRepo

    // When baseRef is 'origin/main' and refs/remotes/origin/main does not exist,
    // it should fall back to refs/heads/main (not check out local origin/main)
    const result = await createWorktree(tmpRepo, {
      branchName: 'agent/test-fallback-origin-main',
      baseRef: 'origin/main',
    });
    expect(fs.existsSync(result.worktreePath)).toBe(true);
    const actualCommit = execSync('git rev-parse HEAD', { cwd: result.worktreePath }).toString().trim();
    expect(actualCommit).toBe(mainCommit);
  });
});

