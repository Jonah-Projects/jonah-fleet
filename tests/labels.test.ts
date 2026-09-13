import { describe, it, expect, vi } from 'vitest';
import {
  isLabelProtected,
  classifyLabels,
  fetchRepoLabels,
  pruneLabels,
  provisionLabels,
  FLEET_CORE_LABELS,
  DEFAULT_PROTECTED_LABEL_PATTERNS,
  RepoLabelInfo,
} from '../src/lib/labels.js';
import { runLabels } from '../src/commands/labels.js';

describe('Label Protection Matching', () => {
  it('matches default fleet taxonomy exact and wildcard patterns', () => {
    // Exact matches
    expect(isLabelProtected('needs-triage')).toBe(true);
    expect(isLabelProtected('ready-for-agent')).toBe(true);
    expect(isLabelProtected('needs-human')).toBe(true);
    expect(isLabelProtected('needs-info')).toBe(true);
    expect(isLabelProtected('needs-design')).toBe(true);
    expect(isLabelProtected('wontfix')).toBe(true);
    expect(isLabelProtected('measurement')).toBe(true);
    expect(isLabelProtected('blocked')).toBe(true);
    expect(isLabelProtected('dependencies')).toBe(true);
    expect(isLabelProtected('security')).toBe(true);

    // Wildcard prefix matches
    expect(isLabelProtected('priority/P0')).toBe(true);
    expect(isLabelProtected('priority/P1')).toBe(true);
    expect(isLabelProtected('priority/P2')).toBe(true);
    expect(isLabelProtected('priority/P3')).toBe(true);
    expect(isLabelProtected('type/feat')).toBe(true);
    expect(isLabelProtected('type/fix')).toBe(true);
    expect(isLabelProtected('type/chore')).toBe(true);
    expect(isLabelProtected('size/XS')).toBe(true);
    expect(isLabelProtected('size/S')).toBe(true);
    expect(isLabelProtected('size/M')).toBe(true);
    expect(isLabelProtected('size/L')).toBe(true);
    expect(isLabelProtected('size/XL')).toBe(true);
    expect(isLabelProtected('autorelease: pending')).toBe(true);
    expect(isLabelProtected('autorelease: tagged')).toBe(true);

    // Unprotected boilerplate labels
    expect(isLabelProtected('invalid')).toBe(false);
    expect(isLabelProtected('question')).toBe(false);
    expect(isLabelProtected('help wanted')).toBe(false);
    expect(isLabelProtected('good first issue')).toBe(false);
    expect(isLabelProtected('documentation')).toBe(false);
    expect(isLabelProtected('duplicate')).toBe(false);
    expect(isLabelProtected('enhancement')).toBe(false);
    expect(isLabelProtected('bug')).toBe(false);
  });

  it('supports custom user-defined protected label patterns', () => {
    const customPatterns = [...DEFAULT_PROTECTED_LABEL_PATTERNS, 'custom-tag', 'team/*'];

    expect(isLabelProtected('custom-tag', customPatterns)).toBe(true);
    expect(isLabelProtected('team/infra', customPatterns)).toBe(true);
    expect(isLabelProtected('team/backend', customPatterns)).toBe(true);
    expect(isLabelProtected('other-tag', customPatterns)).toBe(false);
  });
});

describe('Label Classification', () => {
  const sampleLabels: RepoLabelInfo[] = [
    {
      id: '1',
      name: 'type/feat',
      description: 'Feature',
      color: 'a2eeef',
      openIssuesCount: 3,
      totalIssuesCount: 10,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 2,
    },
    {
      id: '2',
      name: 'needs-info',
      description: 'Waiting for info',
      color: 'fbca04',
      openIssuesCount: 0,
      totalIssuesCount: 0,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 0,
    },
    {
      id: '3',
      name: 'priority/P3',
      description: 'Low priority',
      color: 'a3e635',
      openIssuesCount: 0,
      totalIssuesCount: 4,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 1,
    },
    {
      id: '4',
      name: 'good first issue',
      description: 'Good for newcomers',
      color: '7057ff',
      openIssuesCount: 0,
      totalIssuesCount: 0,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 0,
    },
    {
      id: '5',
      name: 'help wanted',
      description: 'Extra attention is needed',
      color: '008672',
      openIssuesCount: 0,
      totalIssuesCount: 0,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 0,
    },
    {
      id: '6',
      name: 'legacy-v1',
      description: 'Old legacy tag',
      color: 'ffffff',
      openIssuesCount: 0,
      totalIssuesCount: 12,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 5,
    },
  ];

  it('correctly categorizes labels into active, protected_zero_count, historical, and prunable', () => {
    const classified = classifyLabels(sampleLabels);

    expect(classified.active.map((l) => l.name)).toEqual(['type/feat']);
    expect(classified.protectedZeroCount.map((l) => l.name)).toEqual(['needs-info']);
    expect(classified.historical.map((l) => l.name)).toEqual(['priority/P3', 'legacy-v1']);
    expect(classified.prunable.map((l) => l.name)).toEqual(['good first issue', 'help wanted']);
    expect(classified.all).toHaveLength(6);
  });
});

describe('GraphQL Label Fetching and Pagination', () => {
  it('fetches and aggregates label issue/PR counts with GraphQL pagination', async () => {
    const mockExecutor = vi.fn(async (args: string[]) => {
      const isFirstPage = !args.includes('cursor=PAGE2');
      if (isFirstPage) {
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [
                  {
                    id: 'L1',
                    name: 'type/feat',
                    description: 'Feature work',
                    color: 'a2eeef',
                    issues: { totalCount: 2 },
                    allIssues: { totalCount: 5 },
                    pullRequests: { totalCount: 1 },
                    allPullRequests: { totalCount: 3 },
                  },
                ],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: 'PAGE2',
                },
              },
            },
          },
        });
      } else {
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [
                  {
                    id: 'L2',
                    name: 'invalid',
                    description: 'Invalid issue',
                    color: 'e4e669',
                    issues: { totalCount: 0 },
                    allIssues: { totalCount: 0 },
                    pullRequests: { totalCount: 0 },
                    allPullRequests: { totalCount: 0 },
                  },
                ],
                pageInfo: {
                  hasNextPage: false,
                  endCursor: 'PAGE2_END',
                },
              },
            },
          },
        });
      }
    });

    const labels = await fetchRepoLabels('owner/repo', mockExecutor);

    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({
      id: 'L1',
      name: 'type/feat',
      description: 'Feature work',
      color: 'a2eeef',
      openIssuesCount: 2,
      totalIssuesCount: 5,
      openPullRequestsCount: 1,
      totalPullRequestsCount: 3,
    });
    expect(labels[1]).toEqual({
      id: 'L2',
      name: 'invalid',
      description: 'Invalid issue',
      color: 'e4e669',
      openIssuesCount: 0,
      totalIssuesCount: 0,
      openPullRequestsCount: 0,
      totalPullRequestsCount: 0,
    });
  });
});

describe('Safe Label Pruning Execution', () => {
  it('previews prunable labels in dry-run mode without issuing delete calls', async () => {
    const mockExecutor = vi.fn(async (args: string[]) => {
      if (args[1] === 'graphql') {
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [
                  {
                    id: 'L1',
                    name: 'wontfix',
                    description: null,
                    color: 'ffffff',
                    issues: { totalCount: 0 },
                    allIssues: { totalCount: 0 },
                    pullRequests: { totalCount: 0 },
                    allPullRequests: { totalCount: 0 },
                  },
                  {
                    id: 'L2',
                    name: 'unused-boilerplate',
                    description: null,
                    color: 'ffffff',
                    issues: { totalCount: 0 },
                    allIssues: { totalCount: 0 },
                    pullRequests: { totalCount: 0 },
                    allPullRequests: { totalCount: 0 },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      return '';
    });

    const result = await pruneLabels({
      repo: 'owner/repo',
      dryRun: true,
      executor: mockExecutor,
    });

    expect(result.dryRun).toBe(true);
    expect(result.pruned).toEqual(['unused-boilerplate']);
    expect(result.classified.protectedZeroCount.map((l) => l.name)).toEqual(['wontfix']);
    // Ensure gh label delete was NOT called in dry-run
    const deleteCalls = mockExecutor.mock.calls.filter((c) => c[0][0] === 'label' && c[0][1] === 'delete');
    expect(deleteCalls).toHaveLength(0);
  });

  it('deletes prunable labels when dryRun is false and reports outcomes', async () => {
    const mockExecutor = vi.fn(async (args: string[]) => {
      if (args[1] === 'graphql') {
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [
                  {
                    id: 'L1',
                    name: 'unused-boilerplate',
                    description: null,
                    color: 'ffffff',
                    issues: { totalCount: 0 },
                    allIssues: { totalCount: 0 },
                    pullRequests: { totalCount: 0 },
                    allPullRequests: { totalCount: 0 },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (args[0] === 'label' && args[1] === 'delete') {
        return 'Deleted label unused-boilerplate';
      }
      return '';
    });

    const result = await pruneLabels({
      repo: 'owner/repo',
      dryRun: false,
      yes: true,
      executor: mockExecutor,
    });

    expect(result.dryRun).toBe(false);
    expect(result.pruned).toEqual(['unused-boilerplate']);
    expect(result.errors).toHaveLength(0);

    const deleteCalls = mockExecutor.mock.calls.filter((c) => c[0][0] === 'label' && c[0][1] === 'delete');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('unused-boilerplate');
  });
});

describe('CLI Labels Command Execution', () => {
  it('outputs JSON format when --json is provided in audit mode', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockExecutor = vi.fn(async (args: string[]) => {
      if (args[1] === 'graphql') {
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [
                  {
                    id: 'L1',
                    name: 'priority/P1',
                    description: 'High',
                    color: 'e11d48',
                    issues: { totalCount: 1 },
                    allIssues: { totalCount: 3 },
                    pullRequests: { totalCount: 0 },
                    allPullRequests: { totalCount: 0 },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      return '';
    });

    await runLabels('audit', {
      repo: 'owner/repo',
      json: true,
      executor: mockExecutor,
    });

    expect(consoleSpy).toHaveBeenCalled();
    const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(loggedJson.active).toHaveLength(1);
    expect(loggedJson.active[0].name).toBe('priority/P1');

    consoleSpy.mockRestore();
  });

  it('provisions missing fleet labels via provisionLabels and skips existing', async () => {
    const mockExecutor = vi.fn(async (args: string[]) => {
      if (args[1] === 'graphql') {
        // Return existing routine-log label
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [
                  {
                    id: 'L1',
                    name: 'routine-log',
                    description: 'Existing log',
                    color: '5319e7',
                    issues: { totalCount: 0 },
                    allIssues: { totalCount: 0 },
                    pullRequests: { totalCount: 0 },
                    allPullRequests: { totalCount: 0 },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (args[0] === 'label' && args[1] === 'create') {
        return `Created label ${args[2]}`;
      }
      return '';
    });

    const res = await provisionLabels({
      repo: 'owner/repo',
      executor: mockExecutor,
    });

    expect(res.alreadyExists).toContain('routine-log');
    expect(res.created).toContain('status:running');
    expect(res.created).toContain('status:success');
    expect(res.created).toContain('routine:autowork');
    expect(res.errors).toHaveLength(0);

    const createCalls = mockExecutor.mock.calls.filter((c) => c[0][0] === 'label' && c[0][1] === 'create');
    expect(createCalls.length).toBe(FLEET_CORE_LABELS.length - 1);
  });

  it('executes labels provision action via runLabels command', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockExecutor = vi.fn(async (args: string[]) => {
      if (args[1] === 'graphql') {
        return JSON.stringify({
          data: {
            repository: {
              labels: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      return '';
    });

    await runLabels('provision', {
      repo: 'owner/repo',
      executor: mockExecutor,
      json: true,
    });

    expect(consoleSpy).toHaveBeenCalled();
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.created).toContain('routine-log');
    expect(parsed.created).toContain('status:success');
    consoleSpy.mockRestore();
  });
});
