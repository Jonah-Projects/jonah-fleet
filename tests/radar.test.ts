import { describe, it, expect, vi } from 'vitest';
import {
  generateRadarReport,
  evaluateActivity,
  fetchRepoData,
  classifyUpstreamItem,
  classifyAllActivity
} from '../.github/scripts/fetch-symphony-radar.js';

describe('Upstream Ecosystem Radar (Symphony & Funes)', () => {
  const mockSymphonyData = {
    commits: [
      {
        sha: 'abc1234567',
        commit: {
          message: 'feat: add single-flight claim validation',
          author: { name: 'Alice', date: new Date().toISOString() }
        },
        author: { login: 'alice' },
        html_url: 'https://github.com/openai/symphony/commit/abc1234567'
      }
    ],
    specCommits: [
      {
        sha: 'def4567890',
        commit: {
          message: 'docs: update SPEC.md claim lifecycle state machine',
          author: { name: 'Bob', date: new Date().toISOString() }
        },
        author: { login: 'bob' },
        html_url: 'https://github.com/openai/symphony/commit/def4567890'
      }
    ],
    releases: [
      {
        name: 'v0.5.0',
        tag_name: 'v0.5.0',
        published_at: new Date().toISOString(),
        html_url: 'https://github.com/openai/symphony/releases/tag/v0.5.0',
        body: 'Release notes for v0.5.0'
      }
    ],
    pullRequests: [
      {
        number: 42,
        title: 'Add reader/writer separation check',
        merged_at: new Date().toISOString(),
        html_url: 'https://github.com/openai/symphony/pull/42',
        user: { login: 'carol' }
      }
    ]
  };

  const mockFunesData = {
    commits: [
      {
        sha: 'fun1112223',
        commit: {
          message: 'feat(memory): add zero-llm LanceDB transcript indexing',
          author: { name: 'Dave', date: new Date().toISOString() }
        },
        author: { login: 'dave' },
        html_url: 'https://github.com/huggingface/funes/commit/fun1112223'
      }
    ],
    releases: [
      {
        name: 'funes v0.2.0',
        tag_name: 'v0.2.0',
        published_at: new Date().toISOString(),
        html_url: 'https://github.com/huggingface/funes/releases/tag/v0.2.0',
        body: 'Funes memory release 0.2.0'
      }
    ],
    pullRequests: [
      {
        number: 15,
        title: 'Support hybrid BM25 and vector search with RRF',
        merged_at: new Date().toISOString(),
        html_url: 'https://github.com/huggingface/funes/pull/15',
        user: { login: 'eve' }
      }
    ]
  };

  const mockOrbitalData = {
    commits: [
      {
        sha: 'orb1234567',
        commit: {
          message: 'feat(guard): add fail-closed loop guard and repetition circuit breaker',
          author: { name: 'Grace', date: new Date().toISOString() }
        },
        author: { login: 'grace' },
        html_url: 'https://github.com/zqiren/Orbital/commit/orb1234567'
      }
    ],
    releases: [
      {
        name: 'orbital v0.4.0',
        tag_name: 'v0.4.0',
        published_at: new Date().toISOString(),
        html_url: 'https://github.com/zqiren/Orbital/releases/tag/v0.4.0',
        body: 'Orbital release with ACP worker transport'
      }
    ],
    pullRequests: [
      {
        number: 33,
        title: 'Support ACP/PTY worker transport delegation',
        merged_at: new Date().toISOString(),
        html_url: 'https://github.com/zqiren/Orbital/pull/33',
        user: { login: 'heidi' }
      }
    ]
  };

  it('generates a comprehensive report covering Symphony, Funes, and Orbital', () => {
    const report = generateRadarReport({
      symphony: mockSymphonyData,
      funes: mockFunesData,
      orbital: mockOrbitalData,
      lookbackDays: 7,
      serverUrl: 'https://github.com',
      repository: 'juliendurandeu/jonah-fleet',
      runId: '12345'
    });

    // Header and multi-source tracking info
    expect(report).toContain('Upstream Ecosystem Radar: Intel Digest');
    expect(report).toContain('openai/symphony');
    expect(report).toContain('huggingface/funes');
    expect(report).toContain('zqiren/Orbital');

    // Symphony Orchestration section
    expect(report).toContain('Upstream Orchestration Watch (`openai/symphony`)');
    expect(report).toContain('v0.5.0');
    expect(report).toContain('Specification Updates (`SPEC.md`)');
    expect(report).toContain('def4567');
    expect(report).toContain('add single-flight claim validation');
    expect(report).toContain('Add reader/writer separation check');

    // Funes Agent Memory section
    expect(report).toContain('Upstream Agent Memory Watch (`huggingface/funes`)');
    expect(report).toContain('funes v0.2.0');
    expect(report).toContain('add zero-llm LanceDB transcript indexing');
    expect(report).toContain('Support hybrid BM25 and vector search with RRF');

    // Orbital Project Agent & Worker Transports section
    expect(report).toContain('Project Agent & Worker Transports Watch (`zqiren/Orbital`)');
    expect(report).toContain('orbital v0.4.0');
    expect(report).toContain('fail-closed loop guard and repetition circuit breaker');
    expect(report).toContain('Support ACP/PTY worker transport delegation');

    // Evaluation matrices
    expect(report).toContain('Upstream Architectural Evaluation Matrix');
    expect(report).toContain('Zero-Daemon Invariant');
    expect(report).toContain('Issue Tracker Abstraction');
    expect(report).toContain('Token & Cost Economy');
    expect(report).toContain('Multi-Repo Portability');

    // Agent memory specific evaluation
    expect(report).toContain('Agent Memory & Session Indexing Evaluation');
    expect(report).toContain('Zero-LLM Ingestion');
    expect(report).toContain('Pull-Based Memory Delivery');
    expect(report).toContain('Cross-Session Provenance');

    // Orbital specific evaluation
    expect(report).toContain('Project Agent & Worker Transports Evaluation (Orbital Integration)');
    expect(report).toContain('Layer-1 Context Memory Files');
    expect(report).toContain('ACP/PTY Worker Transports');
    expect(report).toContain('Prompt Prefix Caching Benchmarks');
    expect(report).toContain('Fail-Closed Safety Guards');

    // Classification & Checklist
    expect(report).toContain('Category A');
    expect(report).toContain('Category B');
    expect(report).toContain('Category C');
    expect(report).toContain('Maintainer & Optimizer Triage Checklist');
  });

  it('correctly evaluates new activity when only Orbital has updates', () => {
    const emptySymphony = { commits: [], specCommits: [], releases: [], pullRequests: [] };
    const emptyFunes = { commits: [], releases: [], pullRequests: [] };
    const { hasNewActivity, shouldCreateIssue, orbitalActivity } = evaluateActivity(
      emptySymphony,
      emptyFunes,
      mockOrbitalData,
      {
        lookbackDays: 7,
        forceReport: false
      }
    );

    expect(hasNewActivity).toBe(true);
    expect(shouldCreateIssue).toBe(true);
    expect(orbitalActivity).toBe(true);
  });

  it('correctly evaluates new activity when only Funes has updates', () => {
    const emptySymphony = { commits: [], specCommits: [], releases: [], pullRequests: [] };
    const { hasNewActivity, shouldCreateIssue } = evaluateActivity(emptySymphony, mockFunesData, {
      lookbackDays: 7,
      forceReport: false
    });

    expect(hasNewActivity).toBe(true);
    expect(shouldCreateIssue).toBe(true);
  });

  it('correctly evaluates new activity when only Symphony has updates', () => {
    const emptyFunes = { commits: [], releases: [], pullRequests: [] };
    const { hasNewActivity, shouldCreateIssue } = evaluateActivity(mockSymphonyData, emptyFunes, {
      lookbackDays: 7,
      forceReport: false
    });

    expect(hasNewActivity).toBe(true);
    expect(shouldCreateIssue).toBe(true);
  });

  it('handles zero activity gracefully with forceReport=false and forceReport=true', () => {
    const emptySymphony = { commits: [], specCommits: [], releases: [], pullRequests: [] };
    const emptyFunes = { commits: [], releases: [], pullRequests: [] };

    const noForce = evaluateActivity(emptySymphony, emptyFunes, {
      lookbackDays: 7,
      forceReport: false
    });
    expect(noForce.hasNewActivity).toBe(false);
    expect(noForce.shouldCreateIssue).toBe(false);

    const withForce = evaluateActivity(emptySymphony, emptyFunes, {
      lookbackDays: 7,
      forceReport: true
    });
    expect(withForce.hasNewActivity).toBe(false);
    expect(withForce.shouldCreateIssue).toBe(true);
  });

  it('handles fetch failures gracefully and returns empty arrays', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error / 403 Rate limit'));

    const data = await fetchRepoData('openai/symphony', { lookbackDays: 7, token: '' });
    expect(data.commits).toEqual([]);
    expect(data.releases).toEqual([]);
    expect(data.pullRequests).toEqual([]);

    global.fetch = originalFetch;
  });

  it('handles fetch failures gracefully for Orbital and returns empty arrays', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error / 403 Rate limit'));

    const data = await fetchRepoData('zqiren/Orbital', { lookbackDays: 7, token: '' });
    expect(data.commits).toEqual([]);
    expect(data.releases).toEqual([]);
    expect(data.pullRequests).toEqual([]);
    expect(data.specCommits).toBeUndefined();

    global.fetch = originalFetch;
  });

  describe('Deterministic Heuristic Classifier', () => {
    it('classifies SPEC.md updates as Category A', () => {
      const res = classifyUpstreamItem({ title: 'docs: update claim state machine' }, { isSpec: true, repo: 'openai/symphony' });
      expect(res.category).toBe('A');
      expect(res.isOpportunity).toBe(true);
      expect(res.badge).toContain('Category A');
      expect(res.rationale).toContain('SPEC.md');
    });

    it('classifies claim protocols and invariants as Category A', () => {
      const res = classifyUpstreamItem({ title: 'feat: add single-flight claim validation check' }, { repo: 'openai/symphony' });
      expect(res.category).toBe('A');
      expect(res.isOpportunity).toBe(true);
      expect(res.badge).toContain('Category A');
      expect(res.rationale).toContain('claim protocols');
    });

    it('classifies security and token budget controls as Category A', () => {
      const sec = classifyUpstreamItem({ title: 'fix: scrub token alias credentials from log output' }, { repo: 'openai/symphony' });
      expect(sec.category).toBe('A');
      expect(sec.isOpportunity).toBe(true);

      const budget = classifyUpstreamItem({ title: 'feat: prevent loop stagnation when token budget ceiling reached' }, { repo: 'openai/symphony' });
      expect(budget.category).toBe('A');
      expect(budget.isOpportunity).toBe(true);
    });

    it('classifies zero-LLM deterministic ingestion as Category A', () => {
      const res = classifyUpstreamItem({ title: 'feat(memory): add zero-llm deterministic indexing for transcripts' }, { repo: 'huggingface/funes' });
      expect(res.category).toBe('A');
      expect(res.isOpportunity).toBe(true);
      expect(res.rationale).toContain('zero-LLM');
    });

    it('classifies MCP tools and memory retrieval as Category B', () => {
      const mcp = classifyUpstreamItem({ title: 'feat(mcp): add recall tool with hybrid vector search' }, { repo: 'huggingface/funes' });
      expect(mcp.category).toBe('B');
      expect(mcp.isOpportunity).toBe(true);
      expect(mcp.badge).toContain('Category B');
      expect(mcp.rationale).toContain('Agent memory or MCP');

      const pacing = classifyUpstreamItem({ title: 'feat: dynamic backpressure and orchestrator pacing' }, { repo: 'openai/symphony' });
      expect(pacing.category).toBe('B');
      expect(pacing.isOpportunity).toBe(true);
      expect(pacing.badge).toContain('Category B');
    });

    it('classifies non-GitHub platforms and low-level internals as Category C', () => {
      const gitlab = classifyUpstreamItem({ title: 'Use Bearer authentication for GitLab API requests (#124)' }, { repo: 'openai/symphony' });
      expect(gitlab.category).toBe('C');
      expect(gitlab.isOpportunity).toBe(false);
      expect(gitlab.badge).toContain('Category C');
      expect(gitlab.rationale).toContain('non-GitHub');

      const elixir = classifyUpstreamItem({ title: 'refactor: supervise OTP BEAM worker tree' }, { repo: 'openai/symphony' });
      expect(elixir.category).toBe('C');
      expect(elixir.isOpportunity).toBe(false);

      const bump = classifyUpstreamItem({ title: 'Bump lance version to 11' }, { repo: 'huggingface/funes' });
      expect(bump.category).toBe('C');
      expect(bump.isOpportunity).toBe(false);

      const cache = classifyUpstreamItem({ title: 'Workaround corrupt cache entries' }, { repo: 'huggingface/funes' });
      expect(cache.category).toBe('C');
      expect(cache.isOpportunity).toBe(false);

      const query = classifyUpstreamItem({ title: 'fix(push): select pending rows without a giant id filter' }, { repo: 'huggingface/funes' });
      expect(query.category).toBe('C');
      expect(query.isOpportunity).toBe(false);
    });

    it('aggregates activity and surfaces opportunities in classifyAllActivity', () => {
      const analysis = classifyAllActivity(
        {
          specCommits: [{ sha: 'spec111', commit: { message: 'update SPEC.md', author: { name: 'Dev', date: new Date().toISOString() } }, html_url: 'https://github.com' }],
          pullRequests: [{ number: 124, title: 'Use Bearer auth for GitLab', html_url: 'https://github.com' }],
          releases: [],
          commits: [{ sha: 'c124', commit: { message: 'Use Bearer auth for GitLab (#124)', author: { name: 'Dev', date: new Date().toISOString() } }, html_url: 'https://github.com' }]
        },
        {
          pullRequests: [
            { number: 146, title: 'Bump lance version to 11', html_url: 'https://github.com' },
            { number: 147, title: 'Add MCP recall tool', html_url: 'https://github.com' }
          ],
          releases: [],
          commits: []
        }
      );

      expect(analysis.counts.A).toBe(1); // spec commit
      expect(analysis.counts.B).toBe(1); // MCP recall PR
      expect(analysis.counts.C).toBe(2); // GitLab PR + lance PR
      expect(analysis.hasActionableOpportunities).toBe(true);
      // The commit with (#124) should be deduplicated since PR #124 is present
      expect(analysis.items.some(i => i.type === 'commit' && i.title.includes('(#124)'))).toBe(false);
    });

    it('generates a report highlighting opportunities when Category A or B exists', () => {
      const now = new Date().toISOString();
      const report = generateRadarReport({
        symphony: {
          commits: [],
          specCommits: [{ sha: 's1', commit: { message: 'docs: update SPEC.md claim lifecycle', author: { name: 'Dev', date: now } }, html_url: 'https://github.com' }],
          releases: [],
          pullRequests: []
        },
        funes: {
          commits: [],
          releases: [],
          pullRequests: [{ number: 99, title: 'feat: add MCP recall tool', merged_at: now, html_url: 'https://github.com' }]
        },
        lookbackDays: 7
      });

      expect(report).toContain('Upstream Opportunities & Triage Summary');
      expect(report).toContain('[!IMPORTANT]');
      expect(report).toContain('Actionable Opportunities Detected (1 Category A, 1 Category B)');
      expect(report).toContain('Opportunity Breakdown');
      expect(report).toContain('🟢 **Category A** (Adopt Directly)');
      expect(report).toContain('🟡 **Category B** (Adapt)');
      expect(report).toContain('- [ ] **Triage Category A Opportunities**');
      expect(report).toContain('- [ ] **Evaluate Category B Adaptations**');
    });

    it('generates a report with clear "Safe to close" notice when all items are Category C', () => {
      const now = new Date().toISOString();
      const report = generateRadarReport({
        symphony: {
          commits: [],
          specCommits: [],
          releases: [],
          pullRequests: [{ number: 124, title: 'Use Bearer authentication for GitLab API requests', merged_at: now, html_url: 'https://github.com' }]
        },
        funes: {
          commits: [],
          releases: [],
          pullRequests: [{ number: 146, title: 'Bump lance version to 11', merged_at: now, html_url: 'https://github.com' }]
        },
        lookbackDays: 7
      });

      expect(report).toContain('Upstream Opportunities & Triage Summary');
      expect(report).toContain('[!NOTE]');
      expect(report).toContain('No Actionable Opportunities (All 2 items Category C / Skip)');
      expect(report).toContain('Safe to review and close without action');
      expect(report).toContain('🔴 **Category C** (Skip)');
      expect(report).toContain('- [x] **Category A Gate**: No direct adoption items detected this cycle.');
      expect(report).toContain('- [x] **Category B Gate**: No candidate adaptation items detected this cycle.');
      expect(report).toContain('- [ ] **Close Issue**: Close once triage is verified (all items Category C — safe to close immediately).');
    });

    it('classifies prompt engineering optimizations as Category A', () => {
      const promptOpt = classifyUpstreamItem({ title: 'feat: prompt engineering optimizations for tool calling' }, { repo: 'openai/symphony' });
      expect(promptOpt.category).toBe('A');
      expect(promptOpt.isOpportunity).toBe(true);
      expect(promptOpt.badge).toContain('Category A');
      expect(promptOpt.rationale).toContain('Prompt engineering');

      const sysPrompt = classifyUpstreamItem({ title: 'refactor: system prompt refinement for claim checks' }, { repo: 'openai/symphony' });
      expect(sysPrompt.category).toBe('A');
      expect(sysPrompt.isOpportunity).toBe(true);
    });

    it('falls back to release tag_name when release name is absent', () => {
      const relWithTag = classifyUpstreamItem({ tag_name: 'v0.6.0-claim-invariants' }, { repo: 'openai/symphony' });
      expect(relWithTag.category).toBe('A');
      expect(relWithTag.isOpportunity).toBe(true);
      expect(relWithTag.badge).toContain('Category A');
    });

    it('gives Category A invariant keywords precedence over platform/runtime keywords', () => {
      const elixirClaim = classifyUpstreamItem({ title: 'feat(elixir): single-flight claim lock state machine in OTP runner' }, { repo: 'openai/symphony' });
      expect(elixirClaim.category).toBe('A');
      expect(elixirClaim.isOpportunity).toBe(true);
      expect(elixirClaim.rationale).toContain('claim protocols');

      const gitlabClaim = classifyUpstreamItem({ title: 'docs(gitlab): align claim invariant protocol with github actions' }, { repo: 'openai/symphony' });
      expect(gitlabClaim.category).toBe('A');
      expect(gitlabClaim.isOpportunity).toBe(true);

      const otpBudget = classifyUpstreamItem({ title: 'fix(otp): token budget and stagnation controls for beam runners' }, { repo: 'openai/symphony' });
      expect(otpBudget.category).toBe('A');
      expect(otpBudget.isOpportunity).toBe(true);
    });

    it('generates checklist with refined phrasing when zero activity is detected (total === 0)', () => {
      const report = generateRadarReport({
        symphony: { commits: [], specCommits: [], releases: [], pullRequests: [] },
        funes: { commits: [], releases: [], pullRequests: [] },
        orbital: { commits: [], releases: [], pullRequests: [] },
        lookbackDays: 7
      });

      expect(report).toContain('Upstream Opportunities & Triage Summary');
      expect(report).toContain('[!NOTE]');
      expect(report).toContain('Zero Activity Detected');
      expect(report).toContain('- [ ] **Close Issue**: Close once triage is verified (no upstream items detected — safe to close immediately).');
      expect(report).not.toContain('all items Category C — safe to close immediately');
    });

    it('classifies Orbital fail-closed safety guards and loop circuit breakers as Category A', () => {
      const guard = classifyUpstreamItem({ title: 'feat(guard): add fail-closed loop guard and repetition circuit breaker' }, { repo: 'zqiren/Orbital' });
      expect(guard.category).toBe('A');
      expect(guard.isOpportunity).toBe(true);
      expect(guard.badge).toContain('Category A');
      expect(guard.rationale).toContain('Fail-closed safety guard');

      const hash = classifyUpstreamItem({ title: 'fix: action hash cycle detection to halt runaway token burn' }, { repo: 'zqiren/Orbital' });
      expect(hash.category).toBe('A');
      expect(hash.isOpportunity).toBe(true);
    });

    it('classifies Orbital prompt prefix caching optimizations as Category A', () => {
      const cache = classifyUpstreamItem({ title: 'perf: prompt prefix caching tiering to maximize hit rate' }, { repo: 'zqiren/Orbital' });
      expect(cache.category).toBe('A');
      expect(cache.isOpportunity).toBe(true);
      expect(cache.badge).toContain('Category A');
    });

    it('classifies Orbital ACP/PTY worker transports as Category B', () => {
      const transport = classifyUpstreamItem({ title: 'feat: add ACP/PTY worker transport delegation' }, { repo: 'zqiren/Orbital' });
      expect(transport.category).toBe('B');
      expect(transport.isOpportunity).toBe(true);
      expect(transport.badge).toContain('Category B');
      expect(transport.rationale).toContain('worker transport');
    });

    it('classifies Orbital internal details as Category C', () => {
      const internal = classifyUpstreamItem({ title: 'refactor: clean up internal logger formatting' }, { repo: 'zqiren/Orbital' });
      expect(internal.category).toBe('C');
      expect(internal.isOpportunity).toBe(false);
      expect(internal.badge).toContain('Category C');
      expect(internal.rationale).toContain('Orbital');
    });

    it('aggregates activity across Symphony, Funes, and Orbital in classifyAllActivity', () => {
      const analysis = classifyAllActivity(
        {
          specCommits: [{ sha: 'spec111', commit: { message: 'update SPEC.md', author: { name: 'Dev', date: new Date().toISOString() } }, html_url: 'https://github.com' }],
          pullRequests: [],
          releases: [],
          commits: []
        },
        {
          pullRequests: [{ number: 147, title: 'Add MCP recall tool', html_url: 'https://github.com' }],
          releases: [],
          commits: []
        },
        {
          pullRequests: [{ number: 33, title: 'Support ACP/PTY worker transport delegation', html_url: 'https://github.com' }],
          releases: [{ name: 'v0.4.0', published_at: new Date().toISOString(), html_url: 'https://github.com' }],
          commits: [{ sha: 'orb1', commit: { message: 'feat: fail-closed circuit breaker', author: { name: 'Dev', date: new Date().toISOString() } }, html_url: 'https://github.com' }]
        }
      );

      expect(analysis.counts.A).toBe(2); // spec commit + fail-closed commit
      expect(analysis.counts.B).toBe(2); // MCP recall PR + ACP/PTY PR
      expect(analysis.hasActionableOpportunities).toBe(true);
      expect(analysis.items.some(i => i.repo === 'zqiren/Orbital')).toBe(true);
    });
  });
});
