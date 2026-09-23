import { describe, it, expect, vi } from 'vitest';
import { runContribute, prepareContributionPayload } from '../src/commands/contribute.js';

describe('Contribute Command & Upstream Bridge', () => {
  it('prepares structured contribution payload with default metadata', () => {
    const payload = prepareContributionPayload();
    expect(payload.repo).toBe('Jonah-Projects/jonah-fleet');
    expect(payload.branchName).toMatch(/^contrib\/optimize-/);
    expect(payload.title).toContain('fix(prompts):');
    expect(payload.body).toContain('Proposed prompt optimization');
    expect(payload.prCommand).toContain('gh pr create --repo Jonah-Projects/jonah-fleet');
  });

  it('prepares contribution payload with custom title and body', () => {
    const payload = prepareContributionPayload({
      title: 'feat(prompts): add strict claim validation tiebreaker',
      body: 'Discovered race condition in production autowork logs.',
      prompt: 'autowork.md',
    });

    expect(payload.title).toBe('feat(prompts): add strict claim validation tiebreaker');
    expect(payload.body).toContain('Discovered race condition');
    expect(payload.prompt).toBe('autowork.md');
    expect(payload.prCommand).toContain('--title "feat(prompts): add strict claim validation tiebreaker"');
  });

  it('runs contribute in dry-run mode without invoking gh', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runContribute({
      title: 'fix(prompts): prevent ping-pong review bounces',
      body: 'Cap bounce threshold at 3 rounds.',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.title).toBe('fix(prompts): prevent ping-pong review bounces');
    expect(logSpy).toHaveBeenCalled();
  });

  it('executes gh auth check and pr creation via injected mock executor', async () => {
    const executedCommands: string[] = [];
    const mockExecutor = async (args: string[]) => {
      const cmd = args.join(' ');
      executedCommands.push(cmd);
      if (cmd.includes('auth status')) return 'Logged in to github.com';
      if (cmd.includes('pr create')) return 'https://github.com/Jonah-Projects/jonah-fleet/pull/99';
      return '';
    };

    const result = await runContribute({
      title: 'fix(prompts): handle merge tree collisions',
      body: 'Detailed rationale and evidence.',
      executor: mockExecutor,
    });

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/Jonah-Projects/jonah-fleet/pull/99');
    expect(executedCommands.some((c) => c.includes('auth status'))).toBe(true);
    expect(executedCommands.some((c) => c.includes('pr create'))).toBe(true);
  });

  it('handles gh auth failure gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockExecutor = async (args: string[]) => {
      if (args.join(' ').includes('auth status')) {
        throw new Error('Not logged in');
      }
      return '';
    };

    const result = await runContribute({
      executor: mockExecutor,
      throwOnError: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Not logged in');
    expect(errorSpy).toHaveBeenCalled();
  });
});
