import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || '7', 10);
const FORCE_REPORT = process.env.FORCE_REPORT === 'true';
const GITHUB_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL || 'https://github.com';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'juliendurandeu/jonah-fleet';
const GITHUB_RUN_ID = process.env.GITHUB_RUN_ID || 'manual';

export function getHeaders(token = GITHUB_TOKEN) {
  return {
    'User-Agent': 'jonah-fleet-upstream-radar',
    'Accept': 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export async function apiFetch(repo, endpoint, token = GITHUB_TOKEN) {
  const url = `https://api.github.com/repos/${repo}/${endpoint}`;
  try {
    const res = await fetch(url, { headers: getHeaders(token) });
    if (!res.ok) {
      console.warn(`Warning: GitHub API returned ${res.status} for ${repo}/${endpoint}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`Error fetching ${repo}/${endpoint}:`, err);
    return null;
  }
}

export async function fetchRepoData(repo, options = {}) {
  const token = options.token ?? GITHUB_TOKEN;
  const isSymphony = options.isSymphony ?? repo.includes('symphony');

  const promises = [
    apiFetch(repo, 'commits?per_page=15', token),
    apiFetch(repo, 'releases?per_page=5', token),
    apiFetch(repo, 'pulls?state=closed&per_page=10', token)
  ];

  if (isSymphony) {
    promises.push(apiFetch(repo, 'commits?path=SPEC.md&per_page=5', token));
  }

  const results = await Promise.all(promises);
  const commits = Array.isArray(results[0]) ? results[0] : [];
  const releases = Array.isArray(results[1]) ? results[1] : [];
  const pullRequests = Array.isArray(results[2]) ? results[2] : [];
  const specCommits = isSymphony && Array.isArray(results[3]) ? results[3] : [];

  return {
    commits,
    releases,
    pullRequests,
    ...(isSymphony ? { specCommits } : {})
  };
}

export function evaluateActivity(symphonyData, funesData, orbitalDataOrOptions = {}, maybeOptions = {}) {
  let orbitalData = null;
  let options = {};

  if (arguments.length >= 4) {
    orbitalData = orbitalDataOrOptions || null;
    options = maybeOptions || {};
  } else {
    const isOptions = orbitalDataOrOptions && (
      'lookbackDays' in orbitalDataOrOptions ||
      'forceReport' in orbitalDataOrOptions
    );
    const isOrbitalData = orbitalDataOrOptions && (
      'commits' in orbitalDataOrOptions ||
      'releases' in orbitalDataOrOptions ||
      'pullRequests' in orbitalDataOrOptions
    );

    if (isOptions && !isOrbitalData) {
      orbitalData = null;
      options = orbitalDataOrOptions || {};
    } else {
      orbitalData = isOrbitalData ? orbitalDataOrOptions : null;
      options = (isOrbitalData ? maybeOptions : orbitalDataOrOptions) || {};
    }
  }

  const lookbackDays = options.lookbackDays ?? LOOKBACK_DAYS;
  const forceReport = options.forceReport ?? FORCE_REPORT;
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const symCommits = (symphonyData?.commits || []).filter(c => new Date(c.commit.author.date) >= cutoffDate);
  const symSpecCommits = (symphonyData?.specCommits || []).filter(c => new Date(c.commit.author.date) >= cutoffDate);
  const symReleases = (symphonyData?.releases || []).filter(r => new Date(r.published_at || r.created_at) >= cutoffDate);
  const symPRs = (symphonyData?.pullRequests || []).filter(p => p.merged_at && new Date(p.merged_at) >= cutoffDate);

  const funesCommits = (funesData?.commits || []).filter(c => new Date(c.commit.author.date) >= cutoffDate);
  const funesReleases = (funesData?.releases || []).filter(r => new Date(r.published_at || r.created_at) >= cutoffDate);
  const funesPRs = (funesData?.pullRequests || []).filter(p => p.merged_at && new Date(p.merged_at) >= cutoffDate);

  const orbCommits = (orbitalData?.commits || []).filter(c => new Date(c.commit.author.date) >= cutoffDate);
  const orbReleases = (orbitalData?.releases || []).filter(r => new Date(r.published_at || r.created_at) >= cutoffDate);
  const orbPRs = (orbitalData?.pullRequests || []).filter(p => p.merged_at && new Date(p.merged_at) >= cutoffDate);

  const symphonyActivity = symCommits.length > 0 || symSpecCommits.length > 0 || symReleases.length > 0 || symPRs.length > 0;
  const funesActivity = funesCommits.length > 0 || funesReleases.length > 0 || funesPRs.length > 0;
  const orbitalActivity = orbCommits.length > 0 || orbReleases.length > 0 || orbPRs.length > 0;

  const hasNewActivity = symphonyActivity || funesActivity || orbitalActivity;
  const shouldCreateIssue = hasNewActivity || forceReport;

  return {
    hasNewActivity,
    shouldCreateIssue,
    symphonyActivity,
    funesActivity,
    orbitalActivity,
    cutoffDate,
    recent: {
      symphony: { commits: symCommits, specCommits: symSpecCommits, releases: symReleases, pullRequests: symPRs },
      funes: { commits: funesCommits, releases: funesReleases, pullRequests: funesPRs },
      orbital: { commits: orbCommits, releases: orbReleases, pullRequests: orbPRs }
    }
  };
}

/**
 * Classifies an upstream change (commit, PR, spec update, release) into Category A, B, or C.
 *
 * - Category A (Adopt Directly): Security guardrails, claim lock invariants, reader/writer rules,
 *   token budget optimizations, deterministic zero-LLM indexing, or direct SPEC.md updates.
 * - Category B (Adapt to Actions/CLI): Dynamic orchestrator pacing, backpressure controls,
 *   multi-stage review checks, pull-based memory MCP integrations, hybrid search, trace parsing.
 * - Category C (Skip): Elixir/OTP supervision trees, BEAM internals, non-GitHub platforms (GitLab/Bitbucket),
 *   low-level storage engine bumps, internal caching workarounds, and maintenance/lint refactors.
 */
export function classifyUpstreamItem(item, options = {}) {
  const isSpec = options.isSpec || item.isSpec || false;
  const repo = (options.repo || item.repo || '').toLowerCase();
  const title = (item.title || item.summary || item.name || item.tag_name || item.commit?.message?.split('\n')[0] || '').trim();
  const body = item.body || item.commit?.message || '';
  const text = `${title} ${body}`.toLowerCase();

  // 1. Direct SPEC.md changes are unconditionally Category A
  if (isSpec) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Direct revision to OpenAI Symphony specification (`SPEC.md`); review for claim invariant or protocol updates.'
    };
  }

  // 2. Chores & version bump releases are Category C (triaged via originating PRs)
  const isReleaseChore = /^chore(\([^)]+\))?:\s*(release|bump\s+version|bump\s+to|bump\s+[a-z0-9_-]+\s+version)\b/i.test(title);
  if (isReleaseChore) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Release version bump chore; upstream changes are triaged via their originating PRs.'
    };
  }

  // 3. Category A: Core claim protocols, invariants, security, budget, prompt engineering, safety guards
  // Precedence: Category A invariant and prompt engineering keywords take precedence over general platform/runtime keywords
  const isClaimOrInvariant = /\b(claim|single-flight|claim lock|claim invariant|invariants?|reader[/-]writer|state machine)\b/i.test(text);
  const isSecurityOrToken = /\b(security guardrail|token scrub|token alias|least privilege|credential sanitiz|secret mask|token sanitiz|scrub token|mask secret)\b/i.test(text);
  const isTokenEconomyOrBudget = /\b(token budget|budget ceiling|loop stagnation|retry limit|token limit)\b/i.test(text);
  const isZeroLlmIngest = /\b(zero-llm|deterministic indexing|provenance retention)\b/i.test(text);
  const isPromptEngineering = /\b(prompt engineering|prompt optimiz|system prompt|prefix[- ]cach(?:e|ing)?|prompt cach(?:e|ing)?)\b/i.test(text);
  const isSafetyOrGuard = /\b(fail-closed|circuit breaker|loop guard|action hash|repetition guard)\b/i.test(text);

  if (isClaimOrInvariant) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Touches core claim protocols, reader/writer locks, or orchestration state machine invariants.'
    };
  }

  if (isSafetyOrGuard) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Fail-closed safety guard, repetition guard, or circuit breaker invariant.'
    };
  }

  if (isSecurityOrToken) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Security guardrail or credential/token sanitization pattern relevant to fleet workflows.'
    };
  }

  if (isTokenEconomyOrBudget) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Token economy, budget ceiling, or stagnation prevention optimization.'
    };
  }

  if (isZeroLlmIngest) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Deterministic zero-LLM indexing or provenance retention pattern.'
    };
  }

  if (isPromptEngineering) {
    return {
      category: 'A',
      badge: '🟢 **Category A** (Adopt Directly)',
      isOpportunity: true,
      rationale: 'Prompt engineering optimization or system prompt refinement relevant to fleet routines.'
    };
  }

  // 4. Filter explicit platform mismatches & runtime-specific internals to Category C
  const isGitLabOrNonGitHub = /\b(gitlab|bitbucket|azure)\b/i.test(text);
  if (isGitLabOrNonGitHub) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Targets non-GitHub issue tracker or provider not applicable to Jonah Fleet.'
    };
  }

  const isElixirInternals = /\b(elixir|otp|beam|mix|phoenix)\b/i.test(text);
  if (isElixirInternals) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Elixir/OTP/BEAM runtime internal specific to Symphony; skip for Node.js/Actions architecture.'
    };
  }

  const isLowLevelBuildOrMath = /\b(protoc|vexp|gemm|denormal|simd|subnormal|microcode|fma)\b/i.test(text);
  if (isLowLevelBuildOrMath) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Upstream low-level compiler, build tool, or floating-point math detail; no action needed.'
    };
  }

  const isInternalCiOrBuild = /\b(ci|workflow|actions|build scripts?)\b/i.test(title) && (repo.includes('funes') || repo.includes('symphony'));
  if (isInternalCiOrBuild) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Upstream CI or build workflow detail; not applicable to fleet architecture.'
    };
  }

  const isCacheOrInternal = /\b(corrupt cache|repair cached|workaround corrupt|refuse a cached|scan blocks|trim lance)\b/i.test(text);
  if (isCacheOrInternal) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Upstream low-level binary cache workaround or internal dataset scan detail; no action needed.'
    };
  }

  const isLowLevelDepOrBump = /\b(bump lance|bump version|dependency bump|dependencies)\b/i.test(text);
  if (isLowLevelDepOrBump) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Internal dependency bump for upstream storage engine; no action required.'
    };
  }

  const isInternalQueryOrFilter = /\b(select pending rows|id filter|giant id filter)\b/i.test(text);
  if (isInternalQueryOrFilter) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Upstream internal database query optimization; not applicable to fleet architecture.'
    };
  }

  // 5. Category B: Adaptable patterns (MCP, memory retrieval, backpressure, review loops, worker transports)
  const isWorkerOrTransport = /\b(acp|pty|worker transport|worker delegation|process transport)\b/i.test(text);
  const isMcpOrTools = /\b(mcp|model context protocol|mcp tool|custom tool|tool definition|skill)\b/i.test(text);
  const isMemoryOrSearch = /\b(recall|hybrid search|bm25|vector search|rrf|operational memory|lessons\.md|layer-1 context|agent memory)\b/i.test(text);
  const isPacingOrReview = /\b(pacing|backpressure|rate limit|review loop|multi-stage review|concurrency)\b/i.test(text);
  const isSessionOrTrace = /\b(session trace|trace parsing|transcript indexing|transcript parsing|tracesource|session replay)\b/i.test(text);

  if (isWorkerOrTransport) {
    return {
      category: 'B',
      badge: '🟡 **Category B** (Adapt)',
      isOpportunity: true,
      rationale: 'Project agent worker transport or ACP/PTY delegation pattern adaptable to Jonah Fleet.'
    };
  }

  if (isMcpOrTools || isMemoryOrSearch) {
    return {
      category: 'B',
      badge: '🟡 **Category B** (Adapt)',
      isOpportunity: true,
      rationale: 'Agent memory or MCP retrieval pattern adaptable as Jonah Fleet skill or routine integration.'
    };
  }

  if (isPacingOrReview || isSessionOrTrace) {
    return {
      category: 'B',
      badge: '🟡 **Category B** (Adapt)',
      isOpportunity: true,
      rationale: 'Orchestrator pacing, session trace parsing, or review loop pattern adaptable to Actions/CLI.'
    };
  }

  // 5. Default Category C
  if (repo.includes('symphony')) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Upstream Symphony implementation detail; not identified as a direct orchestration opportunity.'
    };
  }

  if (repo.includes('orbital')) {
    return {
      category: 'C',
      badge: '🔴 **Category C** (Skip)',
      isOpportunity: false,
      rationale: 'Upstream Orbital internal implementation detail; no immediate action required.'
    };
  }

  return {
    category: 'C',
    badge: '🔴 **Category C** (Skip)',
    isOpportunity: false,
    rationale: 'Upstream Funes internal implementation detail; no immediate action required.'
  };
}

/**
 * Classifies all recent upstream activity and surfaces actionable opportunities.
 */
export function classifyAllActivity(symRecent = {}, funesRecent = {}, orbRecent = {}) {
  const items = [];

  const getPrNumber = (msg) => {
    const match = msg.match(/\(#(\d+)\)/);
    return match ? parseInt(match[1], 10) : null;
  };

  const symPRNumbers = new Set((symRecent.pullRequests || []).map(p => p.number));
  const funesPRNumbers = new Set((funesRecent.pullRequests || []).map(p => p.number));
  const orbPRNumbers = new Set((orbRecent.pullRequests || []).map(p => p.number));

  // 1. SPEC commits (Symphony only)
  for (const sc of (symRecent.specCommits || [])) {
    const summary = sc.commit.message.split('\n')[0];
    const classification = classifyUpstreamItem(sc, { isSpec: true, repo: 'openai/symphony' });
    items.push({
      repo: 'openai/symphony',
      type: 'spec',
      ref: `[\`${sc.sha.slice(0, 7)}\`](${sc.html_url})`,
      title: summary,
      url: sc.html_url,
      ...classification
    });
  }

  // 2. Merged PRs
  for (const pr of (symRecent.pullRequests || [])) {
    const classification = classifyUpstreamItem(pr, { repo: 'openai/symphony' });
    items.push({
      repo: 'openai/symphony',
      type: 'pr',
      ref: `[#${pr.number}](${pr.html_url})`,
      title: pr.title,
      url: pr.html_url,
      ...classification
    });
  }

  for (const pr of (funesRecent.pullRequests || [])) {
    const classification = classifyUpstreamItem(pr, { repo: 'huggingface/funes' });
    items.push({
      repo: 'huggingface/funes',
      type: 'pr',
      ref: `[#${pr.number}](${pr.html_url})`,
      title: pr.title,
      url: pr.html_url,
      ...classification
    });
  }

  for (const pr of (orbRecent.pullRequests || [])) {
    const classification = classifyUpstreamItem(pr, { repo: 'zqiren/Orbital' });
    items.push({
      repo: 'zqiren/Orbital',
      type: 'pr',
      ref: `[#${pr.number}](${pr.html_url})`,
      title: pr.title,
      url: pr.html_url,
      ...classification
    });
  }

  // 3. Releases
  for (const rel of (symRecent.releases || [])) {
    const classification = classifyUpstreamItem(rel, { repo: 'openai/symphony' });
    items.push({
      repo: 'openai/symphony',
      type: 'release',
      ref: `**[${rel.name || rel.tag_name}](${rel.html_url})**`,
      title: rel.name || rel.tag_name,
      url: rel.html_url,
      ...classification
    });
  }

  for (const rel of (funesRecent.releases || [])) {
    const classification = classifyUpstreamItem(rel, { repo: 'huggingface/funes' });
    items.push({
      repo: 'huggingface/funes',
      type: 'release',
      ref: `**[${rel.name || rel.tag_name}](${rel.html_url})**`,
      title: rel.name || rel.tag_name,
      url: rel.html_url,
      ...classification
    });
  }

  for (const rel of (orbRecent.releases || [])) {
    const classification = classifyUpstreamItem(rel, { repo: 'zqiren/Orbital' });
    items.push({
      repo: 'zqiren/Orbital',
      type: 'release',
      ref: `**[${rel.name || rel.tag_name}](${rel.html_url})**`,
      title: rel.name || rel.tag_name,
      url: rel.html_url,
      ...classification
    });
  }

  // 4. Standalone commits
  for (const c of (symRecent.commits || [])) {
    const summary = c.commit.message.split('\n')[0];
    const prNum = getPrNumber(summary);
    if (prNum && symPRNumbers.has(prNum)) continue;
    if ((symRecent.specCommits || []).some(sc => sc.sha === c.sha)) continue;

    const classification = classifyUpstreamItem(c, { repo: 'openai/symphony' });
    items.push({
      repo: 'openai/symphony',
      type: 'commit',
      ref: `[\`${c.sha.slice(0, 7)}\`](${c.html_url})`,
      title: summary,
      url: c.html_url,
      ...classification
    });
  }

  for (const c of (funesRecent.commits || [])) {
    const summary = c.commit.message.split('\n')[0];
    const prNum = getPrNumber(summary);
    if (prNum && funesPRNumbers.has(prNum)) continue;

    const classification = classifyUpstreamItem(c, { repo: 'huggingface/funes' });
    items.push({
      repo: 'huggingface/funes',
      type: 'commit',
      ref: `[\`${c.sha.slice(0, 7)}\`](${c.html_url})`,
      title: summary,
      url: c.html_url,
      ...classification
    });
  }

  for (const c of (orbRecent.commits || [])) {
    const summary = c.commit.message.split('\n')[0];
    const prNum = getPrNumber(summary);
    if (prNum && orbPRNumbers.has(prNum)) continue;

    const classification = classifyUpstreamItem(c, { repo: 'zqiren/Orbital' });
    items.push({
      repo: 'zqiren/Orbital',
      type: 'commit',
      ref: `[\`${c.sha.slice(0, 7)}\`](${c.html_url})`,
      title: summary,
      url: c.html_url,
      ...classification
    });
  }

  const categoryA = items.filter(i => i.category === 'A');
  const categoryB = items.filter(i => i.category === 'B');
  const categoryC = items.filter(i => i.category === 'C');

  return {
    items,
    categoryA,
    categoryB,
    categoryC,
    counts: {
      total: items.length,
      A: categoryA.length,
      B: categoryB.length,
      C: categoryC.length
    },
    hasActionableOpportunities: categoryA.length > 0 || categoryB.length > 0
  };
}

export function generateRadarReport(params = {}) {
  const symphony = params.symphony || { commits: [], specCommits: [], releases: [], pullRequests: [] };
  const funes = params.funes || { commits: [], releases: [], pullRequests: [] };
  const orbital = params.orbital || { commits: [], releases: [], pullRequests: [] };
  const lookbackDays = params.lookbackDays ?? LOOKBACK_DAYS;
  const serverUrl = params.serverUrl || GITHUB_SERVER_URL;
  const repository = params.repository || GITHUB_REPOSITORY;
  const runId = params.runId || GITHUB_RUN_ID;
  const dateStr = params.dateStr || new Date().toISOString().split('T')[0];

  const evalResult = evaluateActivity(symphony, funes, orbital, { lookbackDays, forceReport: true });
  const { symphony: symRecent, funes: funesRecent, orbital: orbRecent } = evalResult.recent;
  const analysis = classifyAllActivity(symRecent, funesRecent, orbRecent);

  let report = `# 📡 Upstream Ecosystem Radar: Intel Digest (${dateStr})\n\n`;
  report += `> Tracking upstream architectural changes, specification updates, and feature additions across:\n`;
  report += `> - [openai/symphony](https://github.com/openai/symphony) (Orchestration & Claim Invariants)\n`;
  report += `> - [huggingface/funes](https://github.com/huggingface/funes) (Agent Memory & Session Indexing)\n`;
  report += `> - [zqiren/Orbital](https://github.com/zqiren/Orbital) (Project Agents & Worker Transports)\n\n`;

  // Top Section: Opportunities & Triage Summary
  report += `## 🎯 Upstream Opportunities & Triage Summary\n\n`;

  if (analysis.counts.A > 0) {
    report += `> [!IMPORTANT]\n`;
    report += `> **Actionable Opportunities Detected (${analysis.counts.A} Category A, ${analysis.counts.B} Category B):**\n`;
    report += `> High-leverage architectural updates detected upstream (e.g. \`SPEC.md\` revisions, claim invariants, or security guardrails). Prioritize reviewing the Category A items below for prompt or workflow adoption.\n\n`;
  } else if (analysis.counts.B > 0) {
    report += `> [!TIP]\n`;
    report += `> **Adaptation Opportunities Detected (${analysis.counts.B} Category B):**\n`;
    report += `> Upstream patterns detected in agent memory, MCP tools, or orchestrator pacing that may be adapted for Jonah Fleet. Review the breakdown below for feasibility.\n\n`;
  } else if (analysis.counts.total > 0) {
    report += `> [!NOTE]\n`;
    report += `> **No Actionable Opportunities (All ${analysis.counts.total} items Category C / Skip):**\n`;
    report += `> Detected upstream changes are low-level runtime internals, dependency bumps, cache management, or non-GitHub infrastructure. **Safe to review and close without action.**\n\n`;
  } else {
    report += `> [!NOTE]\n`;
    report += `> **Zero Activity Detected:** No commits, releases, or pull requests detected in the lookback window (${lookbackDays} days).\n\n`;
  }

  if (analysis.items.length > 0) {
    report += `### 📊 Opportunity Breakdown (Past ${lookbackDays} Days: ${analysis.counts.total} items)\n\n`;
    report += `| Upstream Source | Item / Reference | Classification | Architectural Opportunity & Rationale |\n`;
    report += `|---|---|:---:|---|\n`;
    for (const item of analysis.items) {
      report += `| \`${item.repo}\` | ${item.ref} ${item.title} | ${item.badge} | ${item.rationale} |\n`;
    }
    report += `\n`;
  }

  // Section 1: Symphony
  report += `## 🎼 Upstream Orchestration Watch (\`openai/symphony\`)\n\n`;

  if (symRecent.releases.length > 0) {
    report += `### 🏷️ New Releases\n\n`;
    for (const rel of symRecent.releases) {
      report += `- **[${rel.name || rel.tag_name}](${rel.html_url})** (published ${rel.published_at?.split('T')[0]})\n`;
      if (rel.body) {
        report += `  > ${rel.body.split('\n')[0]}\n`;
      }
    }
    report += `\n`;
  }

  if (symRecent.specCommits.length > 0) {
    report += `### 📜 Specification Updates (\`SPEC.md\`)\n\n`;
    report += `> [!IMPORTANT]\n> Changes were detected in \`SPEC.md\`! Review these to evaluate impact on Jonah Fleet's claim protocols, review loops, or prompt routines.\n\n`;
    for (const sc of symRecent.specCommits) {
      const summary = sc.commit.message.split('\n')[0];
      const author = sc.author?.login ? `@${sc.author.login}` : sc.commit.author.name;
      report += `- [\`${sc.sha.slice(0, 7)}\`](${sc.html_url}) **${summary}** by ${author} (${sc.commit.author.date.split('T')[0]})\n`;
    }
    report += `\n`;
  } else if (symphony.specCommits && symphony.specCommits.length > 0) {
    const latestSpec = symphony.specCommits[0];
    report += `### 📜 Latest \`SPEC.md\` Revision\n\n`;
    report += `*No updates to \`SPEC.md\` in the past ${lookbackDays} days.*\n`;
    report += `- Most recent: [\`${latestSpec.sha.slice(0, 7)}\`](${latestSpec.html_url}) "${latestSpec.commit.message.split('\n')[0]}" (${latestSpec.commit.author.date.split('T')[0]})\n\n`;
  }

  report += `### 🔨 Recent Commits (Past ${lookbackDays} Days: ${symRecent.commits.length})\n\n`;
  if (symRecent.commits.length > 0) {
    for (const c of symRecent.commits) {
      const summary = c.commit.message.split('\n')[0];
      const author = c.author?.login ? `@${c.author.login}` : c.commit.author.name;
      report += `- [\`${c.sha.slice(0, 7)}\`](${c.html_url}) ${summary} (${author}, ${c.commit.author.date.split('T')[0]})\n`;
    }
  } else {
    report += `_No new commits in the past ${lookbackDays} days._\n\n`;
    if (symphony.commits && symphony.commits.length > 0) {
      const latest = symphony.commits[0];
      report += `**Latest repository commit:**\n`;
      report += `- [\`${latest.sha.slice(0, 7)}\`](${latest.html_url}) ${latest.commit.message.split('\n')[0]} (${latest.commit.author.date.split('T')[0]})\n`;
    }
  }
  report += `\n`;

  if (symRecent.pullRequests.length > 0) {
    report += `### 🔀 Merged Pull Requests\n\n`;
    for (const pr of symRecent.pullRequests) {
      const author = pr.user?.login ? `@${pr.user.login}` : 'contributor';
      report += `- [#${pr.number}](${pr.html_url}) **${pr.title}** by ${author} (merged ${pr.merged_at.split('T')[0]})\n`;
    }
    report += `\n`;
  }

  // Section 2: Funes
  report += `## 🧠 Upstream Agent Memory Watch (\`huggingface/funes\`)\n\n`;

  if (funesRecent.releases.length > 0) {
    report += `### 🏷️ New Releases\n\n`;
    for (const rel of funesRecent.releases) {
      report += `- **[${rel.name || rel.tag_name}](${rel.html_url})** (published ${rel.published_at?.split('T')[0]})\n`;
      if (rel.body) {
        report += `  > ${rel.body.split('\n')[0]}\n`;
      }
    }
    report += `\n`;
  }

  report += `### 🔨 Recent Commits (Past ${lookbackDays} Days: ${funesRecent.commits.length})\n\n`;
  if (funesRecent.commits.length > 0) {
    for (const c of funesRecent.commits) {
      const summary = c.commit.message.split('\n')[0];
      const author = c.author?.login ? `@${c.author.login}` : c.commit.author.name;
      report += `- [\`${c.sha.slice(0, 7)}\`](${c.html_url}) ${summary} (${author}, ${c.commit.author.date.split('T')[0]})\n`;
    }
  } else {
    report += `_No new commits in the past ${lookbackDays} days._\n\n`;
    if (funes.commits && funes.commits.length > 0) {
      const latest = funes.commits[0];
      report += `**Latest repository commit:**\n`;
      report += `- [\`${latest.sha.slice(0, 7)}\`](${latest.html_url}) ${latest.commit.message.split('\n')[0]} (${latest.commit.author.date.split('T')[0]})\n`;
    }
  }
  report += `\n`;

  if (funesRecent.pullRequests.length > 0) {
    report += `### 🔀 Merged Pull Requests\n\n`;
    for (const pr of funesRecent.pullRequests) {
      const author = pr.user?.login ? `@${pr.user.login}` : 'contributor';
      report += `- [#${pr.number}](${pr.html_url}) **${pr.title}** by ${author} (merged ${pr.merged_at.split('T')[0]})\n`;
    }
    report += `\n`;
  }

  // Section 3: Orbital
  report += `## 🪐 Project Agent & Worker Transports Watch (\`zqiren/Orbital\`)\n\n`;

  if (orbRecent.releases.length > 0) {
    report += `### 🏷️ New Releases\n\n`;
    for (const rel of orbRecent.releases) {
      report += `- **[${rel.name || rel.tag_name}](${rel.html_url})** (published ${rel.published_at?.split('T')[0]})\n`;
      if (rel.body) {
        report += `  > ${rel.body.split('\n')[0]}\n`;
      }
    }
    report += `\n`;
  }

  report += `### 🔨 Recent Commits (Past ${lookbackDays} Days: ${orbRecent.commits.length})\n\n`;
  if (orbRecent.commits.length > 0) {
    for (const c of orbRecent.commits) {
      const summary = c.commit.message.split('\n')[0];
      const author = c.author?.login ? `@${c.author.login}` : c.commit.author.name;
      report += `- [\`${c.sha.slice(0, 7)}\`](${c.html_url}) ${summary} (${author}, ${c.commit.author.date.split('T')[0]})\n`;
    }
  } else {
    report += `_No new commits in the past ${lookbackDays} days._\n\n`;
    if (orbital.commits && orbital.commits.length > 0) {
      const latest = orbital.commits[0];
      report += `**Latest repository commit:**\n`;
      report += `- [\`${latest.sha.slice(0, 7)}\`](${latest.html_url}) ${latest.commit.message.split('\n')[0]} (${latest.commit.author.date.split('T')[0]})\n`;
    }
  }
  report += `\n`;

  if (orbRecent.pullRequests.length > 0) {
    report += `### 🔀 Merged Pull Requests\n\n`;
    for (const pr of orbRecent.pullRequests) {
      const author = pr.user?.login ? `@${pr.user.login}` : 'contributor';
      report += `- [#${pr.number}](${pr.html_url}) **${pr.title}** by ${author} (merged ${pr.merged_at.split('T')[0]})\n`;
    }
    report += `\n`;
  }

  // Section 4: Evaluation Matrix
  report += `## ⚖️ Upstream Architectural Evaluation Matrix\n\n`;
  report += `Before adopting concepts from \`openai/symphony\`, \`huggingface/funes\`, or \`zqiren/Orbital\`, evaluate them against Jonah Fleet's operational model:\n\n`;
  report += `| Evaluation Layer | Key Question | Invariant Check |\n`;
  report += `|---|---|---|\n`;
  report += `| **1. Zero-Daemon Invariant** | Can this run within ephemeral GitHub Actions + \`agy\` CLI sessions? | Must require zero 24/7 background servers/sockets |\n`;
  report += `| **2. Issue Tracker Abstraction** | Does this map cleanly to GitHub Issues, labels, and PR checks? | Must avoid proprietary non-GitHub metadata dependencies |\n`;
  report += `| **3. Token & Cost Economy** | Does this optimize LLM spend within the 70% weekly budget ceiling (~8.75M tokens)? | Must prevent unbounded retry burn or loop stagnation |\n`;
  report += `| **4. Multi-Repo Portability** | Can this be cleanly distributed via \`agents-manifest.json\` and \`jonah-fleet sync\`? | Must remain 100% repository-agnostic |\n\n`;

  report += `### 🧠 Agent Memory & Session Indexing Evaluation (Funes Integration)\n\n`;
  report += `| Memory Dimension | Funes Pattern | Jonah Fleet Applicability & Guardrails |\n`;
  report += `|---|---|---|\n`;
  report += `| **Zero-LLM Ingestion** | Deterministic parsing of agent session traces (\`.jsonl\`/Parquet) into LanceDB | Extracts patterns and session summaries without spending LLM tokens from weekly budget |\n`;
  report += `| **Pull-Based Memory Delivery** | Delivered on demand via MCP (\`recall\`, \`get\`) | Prevents context window bloat; memory is queried only when explicitly referenced |\n`;
  report += `| **Cross-Session Provenance** | Verbatim turns and provenance retention | Avoids lossy LLM summarization drift across multi-session debugging tasks |\n`;
  report += `| **Multi-Agent Portability** | Agent-agnostic \`TraceSource\` trait (Claude Code, Codex, pi) | Allows Jonah Fleet to analyze sessions across different agent harnesses |\n\n`;

  report += `### 🪐 Project Agent & Worker Transports Evaluation (Orbital Integration)\n\n`;
  report += `| Evaluation Dimension | Orbital Pattern | Jonah Fleet Applicability & Guardrails |\n`;
  report += `|---|---|---|\n`;
  report += `| **Layer-1 Context Memory Files** | In-repo memory files (\`LESSONS.md\`, \`CONTEXT.md\`) maintained directly by agents | Must be authored on PR branches and validated by review; avoids uncommitted disk drift or git merge collisions |\n`;
  report += `| **ACP/PTY Worker Transports** | Agent Client Protocol (ACP) and pseudo-terminal (PTY) delegation to sub-agents | Adaptable for local daemon CLI runner execution; Actions runners remain ephemeral CLI invocations |\n`;
  report += `| **Prompt Prefix Caching Benchmarks** | Partitioning prompt structures into Static $\\rightarrow$ Semi-Stable $\\rightarrow$ Dynamic tiers | Maximizes prefix cache hit rates (~95%) to minimize token spend under the 70% weekly budget ceiling |\n`;
  report += `| **Fail-Closed Safety Guards** | Repetition guards, action-hash cycle detection, and circuit breakers | Enforces hard aborts on repetitive tool error loops to halt runaway token consumption |\n\n`;

  report += `#### 🧭 Classification Guide:\n`;
  report += `- **🟢 Category A (Adopt Directly)**: Security guardrails, claim lock invariants, reader/writer rules, prompt engineering optimizations, deterministic zero-LLM indexing.\n`;
  report += `- **🟡 Category B (Adapt to Actions/CLI)**: Dynamic orchestrator pacing, backpressure controls, multi-stage review checks, pull-based memory MCP integrations.\n`;
  report += `- **🔴 Category C (Skip)**: Elixir/OTP supervision trees, BEAM memory tuning, proprietary runtime internals, always-loaded memory context dumps.\n\n`;

  report += `### 💡 Maintainer & Optimizer Triage Checklist\n\n`;
  report += `- [x] **Automated Classification**: Evaluated ${analysis.counts.total} upstream change(s) (${analysis.counts.A} Category A, ${analysis.counts.B} Category B, ${analysis.counts.C} Category C).\n`;
  if (analysis.counts.A > 0) {
    report += `- [ ] **Triage Category A Opportunities**: Prioritize ${analysis.counts.A} direct adoption candidate(s) for claim protocol or invariant updates.\n`;
  } else {
    report += `- [x] **Category A Gate**: No direct adoption items detected this cycle.\n`;
  }
  if (analysis.counts.B > 0) {
    report += `- [ ] **Evaluate Category B Adaptations**: Assess ${analysis.counts.B} concept(s) for potential Actions/CLI or MCP skill integration.\n`;
  } else {
    report += `- [x] **Category B Gate**: No candidate adaptation items detected this cycle.\n`;
  }
  report += `- [ ] **Zero-Daemon Check**: Confirm no persistent server or long-lived socket requirement is introduced.\n`;
  report += `- [ ] **Token Economy Gate**: Verify that indexing or memory retrieval does not exceed the 70% weekly token ceiling (~8.75M tokens).\n`;
  report += `- [ ] **Prompt & Skill Ports**: If applicable, port routines to \`templates/prompts/\` or \`.agents/skills/\` (e.g. MCP memory skill).\n`;
  report += `- [ ] **Empirical Evals**: Run \`npm run test:evals\` and \`npm test\` to ensure no regressions.\n`;
  report += `- [ ] **Downstream Sync**: Verify \`jonah-fleet sync\` distributes updates cleanly to target repositories.\n`;
  if (analysis.counts.total === 0) {
    report += `- [ ] **Close Issue**: Close once triage is verified (no upstream items detected — safe to close immediately).\n\n`;
  } else if (analysis.counts.A === 0 && analysis.counts.B === 0) {
    report += `- [ ] **Close Issue**: Close once triage is verified (all items Category C — safe to close immediately).\n\n`;
  } else {
    report += `- [ ] **Close Issue**: Close once triage and any resulting PRs are merged.\n\n`;
  }

  report += `---\n_Generated by [Antigravity](${serverUrl}/${repository}/actions/runs/${runId})_\n`;

  return report;
}

export async function runRadar(options = {}) {
  const lookbackDays = options.lookbackDays ?? LOOKBACK_DAYS;
  const forceReport = options.forceReport ?? FORCE_REPORT;
  const token = options.token ?? GITHUB_TOKEN;
  const serverUrl = options.serverUrl ?? GITHUB_SERVER_URL;
  const repository = options.repository ?? GITHUB_REPOSITORY;
  const runId = options.runId ?? GITHUB_RUN_ID;

  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  console.log(`Checking upstream activity (openai/symphony, huggingface/funes & zqiren/Orbital) since ${cutoffDate.toISOString()} (${lookbackDays} days window)...`);

  const [symphony, funes, orbital] = await Promise.all([
    fetchRepoData('openai/symphony', { lookbackDays, token, isSymphony: true }),
    fetchRepoData('huggingface/funes', { lookbackDays, token, isSymphony: false }),
    fetchRepoData('zqiren/Orbital', { lookbackDays, token, isSymphony: false })
  ]);

  const { hasNewActivity, shouldCreateIssue } = evaluateActivity(symphony, funes, orbital, { lookbackDays, forceReport });
  const todayStr = new Date().toISOString().split('T')[0];
  const issueTitle = `📡 Upstream Ecosystem Radar: Intel Digest (${todayStr})`;

  const report = generateRadarReport({
    symphony,
    funes,
    orbital,
    lookbackDays,
    serverUrl,
    repository,
    runId,
    dateStr: todayStr
  });

  const outputPath = options.outputPath || 'radar-report.md';
  fs.writeFileSync(outputPath, report, 'utf8');
  console.log(`Generated ${outputPath} (shouldCreateIssue: ${shouldCreateIssue}, hasNewActivity: ${hasNewActivity})`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_create_issue=${shouldCreateIssue}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_new_activity=${hasNewActivity}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `issue_title=${issueTitle}\n`);
  }

  return {
    shouldCreateIssue,
    hasNewActivity,
    issueTitle,
    report
  };
}

// Auto-run if executed directly as a script
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runRadar().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
