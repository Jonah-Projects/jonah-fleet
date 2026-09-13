import { defaultGhExecutor, GhExecutor } from './fleet-query.js';
import { loadManifest } from './manifest.js';

export interface RepoLabelInfo {
  id: string;
  name: string;
  description?: string | null;
  color?: string;
  openIssuesCount: number;
  totalIssuesCount: number;
  openPullRequestsCount: number;
  totalPullRequestsCount: number;
}

export type LabelCategory = 'active' | 'protected_zero_count' | 'historical' | 'prunable';

export interface ClassifiedLabelItem extends RepoLabelInfo {
  category: LabelCategory;
}

export interface ClassifiedLabels {
  active: ClassifiedLabelItem[];
  protectedZeroCount: ClassifiedLabelItem[];
  historical: ClassifiedLabelItem[];
  prunable: ClassifiedLabelItem[];
  all: ClassifiedLabelItem[];
}

export const DEFAULT_PROTECTED_LABEL_PATTERNS: string[] = [
  'priority/*',
  'type/*',
  'size/*',
  'needs-triage',
  'ready-for-agent',
  'needs-human',
  'needs-info',
  'needs-design',
  'wontfix',
  'measurement',
  'blocked',
  'autorelease:*',
  'dependencies',
  'security',
  'routine-log',
  'routine:*',
  'status:*',
  'runner:*',
  'historical-migration',
];

export function isLabelProtected(
  labelName: string,
  protectedPatterns: string[] = DEFAULT_PROTECTED_LABEL_PATTERNS
): boolean {
  for (const pattern of protectedPatterns) {
    if (pattern === labelName) {
      return true;
    }
    if (pattern.includes('*')) {
      const regexPattern = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      const regex = new RegExp(regexPattern);
      if (regex.test(labelName)) {
        return true;
      }
    }
  }
  return false;
}

export function classifyLabels(
  labels: RepoLabelInfo[],
  protectedPatterns: string[] = DEFAULT_PROTECTED_LABEL_PATTERNS
): ClassifiedLabels {
  const classified: ClassifiedLabels = {
    active: [],
    protectedZeroCount: [],
    historical: [],
    prunable: [],
    all: [],
  };

  for (const label of labels) {
    const isZeroTotal = label.totalIssuesCount === 0 && label.totalPullRequestsCount === 0;
    const hasOpenItems = label.openIssuesCount > 0 || label.openPullRequestsCount > 0;

    let category: LabelCategory;

    if (isZeroTotal) {
      if (isLabelProtected(label.name, protectedPatterns)) {
        category = 'protected_zero_count';
        const item: ClassifiedLabelItem = { ...label, category };
        classified.protectedZeroCount.push(item);
        classified.all.push(item);
      } else {
        category = 'prunable';
        const item: ClassifiedLabelItem = { ...label, category };
        classified.prunable.push(item);
        classified.all.push(item);
      }
    } else if (hasOpenItems) {
      category = 'active';
      const item: ClassifiedLabelItem = { ...label, category };
      classified.active.push(item);
      classified.all.push(item);
    } else {
      category = 'historical';
      const item: ClassifiedLabelItem = { ...label, category };
      classified.historical.push(item);
      classified.all.push(item);
    }
  }

  return classified;
}

export async function resolveRepoName(
  repoIdentifier?: string,
  cwd: string = process.cwd(),
  executor: GhExecutor = defaultGhExecutor
): Promise<string> {
  if (repoIdentifier && repoIdentifier.includes('/')) {
    return repoIdentifier;
  }
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY.includes('/')) {
    return process.env.GITHUB_REPOSITORY;
  }

  try {
    const raw = await executor(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const trimmed = raw.trim();
    if (trimmed && trimmed.includes('/')) {
      return trimmed;
    }
  } catch {}

  return repoIdentifier || 'current';
}

const LABELS_GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    labels(first: 100, after: $cursor) {
      nodes {
        id
        name
        description
        color
        issues(states: [OPEN]) {
          totalCount
        }
        allIssues: issues {
          totalCount
        }
        pullRequests(states: [OPEN]) {
          totalCount
        }
        allPullRequests: pullRequests {
          totalCount
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`;

export async function fetchRepoLabels(
  repoIdentifier?: string,
  executor: GhExecutor = defaultGhExecutor,
  cwd: string = process.cwd()
): Promise<RepoLabelInfo[]> {
  const fullRepo = await resolveRepoName(repoIdentifier, cwd, executor);
  const [owner, repo] = fullRepo.split('/');

  if (!owner || !repo) {
    throw new Error(`Invalid repository identifier '${fullRepo}'. Expected format 'owner/repo'.`);
  }

  const results: RepoLabelInfo[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const queryArgs = [
      'api',
      'graphql',
      '-f',
      `query=${LABELS_GRAPHQL_QUERY}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `repo=${repo}`,
    ];

    if (cursor) {
      queryArgs.push('-F', `cursor=${cursor}`);
    }

    const raw = await executor(queryArgs);
    const parsed = JSON.parse(raw);

    if (parsed.errors && parsed.errors.length > 0) {
      throw new Error(`GitHub GraphQL query failed: ${parsed.errors[0].message}`);
    }

    const labelConnection = parsed.data?.repository?.labels;
    if (!labelConnection || !Array.isArray(labelConnection.nodes)) {
      break;
    }

    for (const node of labelConnection.nodes) {
      results.push({
        id: node.id,
        name: node.name,
        description: node.description ?? null,
        color: node.color,
        openIssuesCount: node.issues?.totalCount || 0,
        totalIssuesCount: node.allIssues?.totalCount || 0,
        openPullRequestsCount: node.pullRequests?.totalCount || 0,
        totalPullRequestsCount: node.allPullRequests?.totalCount || 0,
      });
    }

    hasNextPage = Boolean(labelConnection.pageInfo?.hasNextPage);
    cursor = labelConnection.pageInfo?.endCursor || null;
    if (!cursor) {
      break;
    }
  }

  return results;
}

export interface PruneLabelsOptions {
  repo?: string;
  dryRun?: boolean;
  yes?: boolean;
  cwd?: string;
  protectedPatterns?: string[];
  executor?: GhExecutor;
}

export interface PruneLabelsResult {
  repo: string;
  classified: ClassifiedLabels;
  pruned: string[];
  skipped: string[];
  errors: Array<{ label: string; error: string }>;
  dryRun: boolean;
}

export async function pruneLabels(options: PruneLabelsOptions = {}): Promise<PruneLabelsResult> {
  const cwd = options.cwd || process.cwd();
  const executor = options.executor || defaultGhExecutor;
  const repo = await resolveRepoName(options.repo, cwd, executor);

  const manifest = loadManifest(cwd);
  const userProtected = manifest?.labels?.protected || [];
  const protectedPatterns = options.protectedPatterns || [
    ...DEFAULT_PROTECTED_LABEL_PATTERNS,
    ...userProtected,
  ];

  const rawLabels = await fetchRepoLabels(repo, executor, cwd);
  const classified = classifyLabels(rawLabels, protectedPatterns);

  const result: PruneLabelsResult = {
    repo,
    classified,
    pruned: [],
    skipped: [],
    errors: [],
    dryRun: Boolean(options.dryRun),
  };

  for (const item of classified.prunable) {
    if (options.dryRun) {
      result.pruned.push(item.name);
    } else {
      try {
        const deleteArgs = ['label', 'delete', item.name, '--yes'];
        if (repo && repo !== 'current') {
          deleteArgs.push('--repo', repo);
        }
        await executor(deleteArgs);
        result.pruned.push(item.name);
      } catch (err: any) {
        result.errors.push({
          label: item.name,
          error: err.message || String(err),
        });
      }
    }
  }

  return result;
}
