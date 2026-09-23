import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
}

export interface CreateWorktreeOptions {
  branchName: string;
  baseRef?: string;
  worktreeDirName?: string;
}

export function getWorktreesBaseDir(repoRoot: string): string {
  return path.join(repoRoot, '.jonah-fleet', 'worktrees');
}

/**
 * Creates an isolated Git worktree for an agent routine execution.
 */
export async function createWorktree(
  repoRoot: string,
  options: CreateWorktreeOptions
): Promise<{ worktreePath: string; branchName: string }> {
  const baseDir = getWorktreesBaseDir(repoRoot);
  fs.mkdirSync(baseDir, { recursive: true });

  const sanitizedDirName = options.worktreeDirName || options.branchName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const worktreePath = path.join(baseDir, sanitizedDirName);

  // If a stale worktree directory exists at the target path, remove it
  if (fs.existsSync(worktreePath)) {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    } catch {
      // Force-remove directory if git worktree remove fails
      fs.rmSync(worktreePath, { recursive: true, force: true });
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {});
    }
  }

  // Determine base ref (try origin/main, main, or HEAD)
  let baseRef = options.baseRef;
  if (!baseRef) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', 'origin/main'], { cwd: repoRoot });
      baseRef = 'origin/main';
    } catch {
      try {
        await execFileAsync('git', ['rev-parse', '--verify', 'main'], { cwd: repoRoot });
        baseRef = 'main';
      } catch {
        baseRef = 'HEAD';
      }
    }
  }

  // Delete existing local branch if present so -b succeeds cleanly
  try {
    await execFileAsync('git', ['branch', '-D', options.branchName], { cwd: repoRoot });
  } catch {
    // Ignore error if branch does not exist
  }

  // Create worktree on a new branch from baseRef
  await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', options.branchName, baseRef], {
    cwd: repoRoot,
  });

  return { worktreePath, branchName: options.branchName };
}

/**
 * Removes a Git worktree and cleans up Git metadata.
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  options: { deleteBranch?: boolean; branchName?: string } = {}
): Promise<void> {
  try {
    if (fs.existsSync(worktreePath)) {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    }
  } catch {
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  } finally {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {});
  }

  if (options.deleteBranch && options.branchName) {
    await execFileAsync('git', ['branch', '-D', options.branchName], { cwd: repoRoot }).catch(() => {});
  }
}

/**
 * Lists all active Jonah Fleet worktrees in the repository.
 */
export async function listActiveWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
    const entries = stdout.trim().split('\n\n');
    const worktrees: WorktreeInfo[] = [];

    const baseDir = path.resolve(getWorktreesBaseDir(repoRoot));

    for (const entry of entries) {
      if (!entry.trim()) continue;
      const lines = entry.split('\n');
      let currentPath = '';
      let currentBranch = '';
      let currentCommit = '';

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.substring(9).trim();
        } else if (line.startsWith('HEAD ')) {
          currentCommit = line.substring(5).trim();
        } else if (line.startsWith('branch ')) {
          currentBranch = line.substring(7).replace('refs/heads/', '').trim();
        }
      }

      const resolvedPath = path.resolve(currentPath);
      if (resolvedPath === baseDir || resolvedPath.startsWith(baseDir + path.sep)) {
        worktrees.push({
          path: resolvedPath,
          branch: currentBranch || 'detached',
          commit: currentCommit,
        });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

export interface CleanupStaleWorktreesOptions {
  keepPath?: string;
}

/**
 * Prunes orphaned worktrees and cleans empty worktree directories.
 */
export async function cleanupStaleWorktrees(
  repoRoot: string,
  options: CleanupStaleWorktreesOptions = {}
): Promise<number> {
  let cleaned = 0;
  try {
    const keepNormalized = options.keepPath ? path.resolve(options.keepPath) : undefined;
    const baseDir = path.resolve(getWorktreesBaseDir(repoRoot));

    // 1. If keepPath is explicitly provided, remove other registered worktrees located within baseDir
    if (keepNormalized) {
      const active = await listActiveWorktrees(repoRoot);
      for (const wt of active) {
        const wtResolved = path.resolve(wt.path);
        const isInsideBaseDir = wtResolved === baseDir || wtResolved.startsWith(baseDir + path.sep);
        if (isInsideBaseDir && wtResolved !== keepNormalized) {
          try {
            await execFileAsync('git', ['worktree', 'remove', '--force', wt.path], { cwd: repoRoot });
          } catch {
            if (fs.existsSync(wt.path)) {
              fs.rmSync(wt.path, { recursive: true, force: true });
            }
          }
          cleaned++;
        }
      }
    }

    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {});

    // 2. Remove any remaining directories in baseDir not matching keepPath
    if (fs.existsSync(baseDir)) {
      const remainingActive = await listActiveWorktrees(repoRoot);
      const remainingActivePaths = new Set(remainingActive.map((w) => path.resolve(w.path)));
      const dirs = fs.readdirSync(baseDir);

      for (const dir of dirs) {
        const fullPath = path.resolve(path.join(baseDir, dir));
        if (fullPath !== keepNormalized && !remainingActivePaths.has(fullPath)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          cleaned++;
        }
      }
    }

    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot }).catch(() => {});
  } catch {
    // Ignore cleanup errors
  }
  return cleaned;
}

