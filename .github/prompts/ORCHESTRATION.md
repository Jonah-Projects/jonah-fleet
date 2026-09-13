# Orchestration Model (Symphony Alignment)

How agent routines in this repository are dispatched, claimed, and reconciled — plus the single-source-of-truth definitions the routine prompts point at (Stale-claim, Log delivery fallback, Measurement issues). Extracted from `AGENTS.md` so this agent-system reference stays out of every session's auto-loaded context; `AGENTS.md` keeps the invariants and points here.

**Read this when** you need the claim protocol, the stale-claim conditions, the log-push rules, or the measurement-issue protocol — i.e. most Autowork, Peer Review, Analytics Review, and Issues Housekeeping runs.

This project's automation is a GitHub-native implementation of the orchestration pattern formalized by OpenAI's [Symphony specification](https://github.com/openai/symphony/blob/main/SPEC.md) for orchestrating autonomous coding agents against an issue tracker. There is **no long-running orchestrator daemon**; the roles map onto GitHub primitives:

| Symphony Concept                                              | Implementation in this repo                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `WORKFLOW.md` (repo-owned config + prompt templates)          | `AGENTS.md` (aliased as `GEMINI.md`/`CLAUDE.md`) + `.github/prompts/*.md`     |
| Orchestrator (poll, dispatch, reconcile)                      | GitHub Actions triggers + scheduled routine sessions                          |
| Issue tracker (Linear in Symphony)                            | GitHub Issues                                                                 |
| Agent runner (Codex app-server in per-issue workspace)        | An ephemeral agent session (Antigravity CLI `agy`) in an isolated fresh clone |
| Tracker is reader/scheduler; mutations happen via agent tools | Routines only schedule; the agent session makes every GitHub write            |

Dispatch is both **scheduled** and **event-driven**. All routines run as ephemeral agent sessions via **Antigravity CLI (`agy`)** powered by **Gemini 3.7 Flash (High reasoning)**. The routine suite is calibrated to operate within a **strict 70% weekly token ceiling across all routines combined**, supervised by `optimizer.md`:

- **Scheduled cron sweeps**: Autowork runs periodically (`autowork-cron.yml`), complemented by prompt optimization (`prompt-optimizer-cron.yml`), issues housekeeping (`issues-housekeeping-cron.yml`), dependency security checks (`dependency-check-cron.yml`), analytics review (`analytics-review-cron.yml`), product planning (`product-planning-cron.yml`), and design review (`design-review-cron.yml`).
- **Event-driven & manual triggers**: GitHub Actions workflows fire routines on events and interactive commands so work starts within seconds instead of waiting for scheduled ticks:
  - `trigger-review-routine.yml` fires Peer Review automatically when a PR is marked ready for review, updated, or review is requested (`ready_for_review`, `opened`, `reopened`, `synchronize`, `review_requested`). It can also be manually (re)triggered via `workflow_dispatch` (with optional `pr_number` for Targeted mode or blank for Scan mode) or by commenting `/review`, `/peer-review`, `/retrigger`, or `/re-review` on any open pull request.
  - `trigger-autowork-on-merge.yml` fires Autowork in **Targeted mode** when a PR merges to `main` and unblocks the next unit of chained work.
  - `trigger-autowork-on-bug.yml` fires Autowork when an issue becomes a high-priority bug.
  - `trigger-autowork-manual.yml` fires Autowork manually via `workflow_dispatch` or badge link click on a specific issue in **Targeted mode**.

Autowork triggers pass the target issue via environment variables (`TARGET_ISSUE`, `ISSUE_NUMBER`, `ISSUE_URL`), putting autowork.md into **Targeted mode** (working the named issue ahead of Phase 1 convergence). Single-flight per issue is strictly enforced across scheduled, event-driven, and manually triggered runs.

Invariants deliberately upheld from this spec:

- **Single-flight per issue and PR convergence** — at most one run works an issue or pull request at a time, enforced by the autowork claim protocol (assign → read-back → earliest-timestamp tiebreak). For **umbrella** issues, single-flight is maintained at the _child-issue_ level so slices progress cleanly.
- **Recover dead-run claims** — a crashed run's orphaned claim is released back to the pool rather than starving the issue or PR, both opportunistically during candidate selection and periodically via issues housekeeping.
- **Reader/writer separation** — the routine that authors a PR never merges it; the Peer Review routine is the sole merge authority for **product** PRs. (Operational log-only PRs are exempt; see Log delivery fallback.)
- **Warm-Context Review Synchronization** — Autowork maintains an active warm session during implementation, polling for Peer Review's verdict. When Peer Review bounces a PR to draft with findings, Autowork immediately detects the draft state in-session, applies fixes directly to its warm working tree, and re-marks the PR ready—re-firing Peer Review for Round N+1 without cold-start overhead.

---

## Stale-Claim Definition

Single source of truth for both autowork candidate reclamation and housekeeping sweeps. An assigned issue is a _stale claim_ (a dead autowork run's orphaned reservation, safe to release) only when **all** of these hold:

1. **It is an autowork claim, not a manual one.** The issue carries a `🔒 Claimed by autowork run …` comment. An assigned issue with **no** such comment is never stale; leave it alone (it may be a person working manually).
2. **No live work exists.** There is **no open PR** referencing the issue (`Closes #N`). An open PR is live, recoverable work that autowork Phase 1 owns — never reclaim it, at any age.
3. **The claim is old.** The most recent `🔒 Claimed by autowork run …` comment's GitHub creation time (`created_at`) is **more than 6 hours** ago. Measure age from that `created_at` only — never the issue's `updated_at`.

**Releasing a stale claim is a destructive write and MUST be guarded:**

- **Re-read immediately before writing.** Re-read the issue (`issue_read`) right before the unassign and re-confirm conditions 1–3 still hold. If any no longer holds, abort the release and move on.
- **Remove only the named dead owner.** Unassign that specific login; never blindly clear all assignees.

---

## PR Stale-Claim Definition (Phase 1 Convergence)

Single source of truth for Autowork Phase 1 pull request convergence. An assigned pull request or draft PR with unaddressed review comments is a _stale claim_ (safe to reclaim and reassign by another runner) only when **all** of these hold:

1. **It carries an autowork claim comment**: The PR thread contains `🔒 Addressing review findings by autowork run …` or `🔒 Addressing review findings by local autowork session …`.
2. **The claim is old**: The most recent claim comment's `created_at` is **more than 2 hours** ago. (2 hours instead of 6 hours because PR review convergence is a rapid turnaround loop).
3. **No active commits or review activity**: No new commit has been pushed to the PR branch within the last 2 hours.

---

## Routine Matching & Invocation

**Identify the applicable routine at the start of every conversation, before doing any work:**

1. **Explicit invocation** — if the incoming prompt names a routine or was fired by a GitHub Actions workflow that references one, follow that routine's instruction file immediately.
2. **Content match** — compare the task against the routine table below. When matching an interactive request from a human, name the matched routine and confirm before proceeding.
3. **No match** — follow the general Working Practices, PR Workflow, and documentation rules with no routine-specific constraints.

| Routine                            | File                                                  | Applies when the conversation is about...                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Autowork                           | `.github/prompts/autowork.md`                         | Converging on open work: addressing PR review comments, closing issues whose PRs merged, then claiming and implementing the highest-priority unclaimed issue |
| Peer Review                        | `.github/prompts/peer-review.md`                      | Reviewing a pull request (a named PR or scan mode) and merging it or leaving findings and bouncing to draft                                                  |
| Prompt Optimizer                   | `.github/prompts/optimizer.md`                        | Diagnosing failures, inefficiency, token anomalies, and analyzing resolved bugs to propose prompt/test/workflow fixes and upstream contributions             |
| Issues Housekeeping                | `.github/prompts/issues-housekeeping.md`              | Sweeping open issues for staleness, duplicates, label drift, priority accuracy, and orphaned claims                                                          |
| Dependency Update & Security Check | `.github/prompts/dependency-update-security-check.md` | Checking dependencies for updates and known vulnerabilities, opening actionable PRs                                                                          |
| Product Planning                   | `.github/prompts/product-planning.md`                 | Turning roadmap priorities into staged issues (`/to-tickets`) and formal PRDs (`/to-spec`)                                                                   |
| Analytics Review                   | `.github/prompts/analytics-review.md`                 | Evaluating telemetry & measurement trackers against success metrics, emitting action directives (PIVOT/DEPRECATE/ITERATE), and bridging to product planning  |
| Design Review                      | `.github/prompts/design-review.md`                    | Auditing player-facing surfaces for design system token deviations, visual clutter, feature pruning, and UX improvements                                      |

---

## Engineering Skills Integration

The routines invoke specialized engineering skills at key workflow checkpoints:

- **Autowork (`autowork.md`)**:
  - `/diagnosing-bugs`: In Targeted mode or for `bug` issues — establishes reproduction feedback loop before patching.
  - `/domain-modeling` & `/codebase-design`: Consults domain context and establishes deep module interfaces.
  - `/tdd`: Drives red-green-refactor test-first implementation for each issue.
  - `/code-review`: Evaluates Standards (`AGENTS.md`) and Spec (`## Tasks`) during pre-ready self-audit.
  - `/resolving-merge-conflicts`: Resolves merge collisions by intent against primary sources when syncing with `origin/main`.
- **Peer Review (`peer-review.md`)**:
  - `/code-review`: Drives multi-angle diff evaluation along Standards and Spec axes.
  - `/resolving-merge-conflicts`: Resolves merge conflicts mechanically before squash-merging.
- **Issues Housekeeping (`issues-housekeeping.md`)**:
  - `/triage`: Evaluates incoming issues into canonical roles.
- **Triage & Interactive Planning**:
  - `/grill-me`: Interrogates proposals and requirements to uncover edge cases and force explicit trade-offs before implementation.
- **Product Planning (`product-planning.md`)**:
  - `/domain-modeling`: Pressure-tests proposals and records domain terms / ADRs.
  - `/grill-me`: Stress-tests proposed roadmaps and user stories.
  - `/to-spec`: Authors formal PRDs for larger proposals.
  - `/to-tickets`: Decomposes approved epics/proposals into dependency-linked issues.
- **Prompt Optimizer (`optimizer.md`)**:
  - `/writing-for-agents`: Drafts crisp, token-efficient prompt and rule updates.
- **Design Review (`design-review.md`)**:
  - `/design-system`: Analyzes styling diffs and static components for token purity and pattern alignment.
  - `/run`: Boots dev environment and automates mobile/desktop viewport captures.
  - `/design-critique`: Analyzes captured screenshots for visual hierarchy, clutter, spacing, and contrast.

---

## Log Delivery Fallback

Single source of truth for every routine's Logging section:

1. **Direct commit to `main` is default**: For operational run logs under `.github/prompts/logs/**`, commit directly to `main` via GitHub API or git push. Never commit logs to an active feature branch.
2. **Mandatory `[skip ci]`**: All log commits MUST include `[skip ci]` in the commit message (e.g. `docs(log): record {routine-name} run {timestamp} [skip ci]`) to prevent unnecessary CI executions or approval blocks.
3. **Draft PR fallback**: If direct push fails, commit the log to a dedicated, fresh branch and open a draft PR carrying only the log files.
4. **Automated landing**: `auto-merge-log-prs.yml` or `issues-housekeeping.md` lands accumulated log PRs. Draft log PRs are never reviewed by Peer Review and do not count toward Autowork's backpressure limits.

---

## Token Anomaly Triage & Remediation

How token spend, runaway loops, and budget anomalies are detected, triaged, and remediated autonomously across the fleet:

1. **Supervised Token Ceiling**: The fleet operates under a global 70% weekly token ceiling (~8.75M tokens/week across all routines). `optimizer.md` evaluates pacing during each scheduled sweep.
2. **Anomaly Classification & Heuristics**:
   - **Token Surge**: Average token spend per run for a specific routine increases >50% week-over-week. Trigger: prompt bloat or runaway context accumulation. Remediation: prompt instruction pruning, replacing verbose guidelines with concise leading words and progressive disclosure pointers.
   - **Budget Hog**: A single agent routine consumes >75% of total fleet token allowance. Trigger: unbalanced dispatch frequency or unbounded candidate sweeps. Remediation: throttle cron frequency, introduce stricter candidate batching, or add early exit conditions.
   - **Iteration Ceiling Exhaustion**: >20% of runs in a routine terminate at the `token_limit` / max iteration cap. Trigger: tasks too complex for single-flight execution or unbounded looping. Remediation: enforce vertical slicing / umbrella decomposition, tighten pre-ready self-audits, or refine termination bounds.
   - **Review Loop Burn**: Pull requests experiencing $\ge 3$ bounce rounds between autowork and peer-review. Trigger: ambiguous reviewer feedback, pedantic non-blocking findings, or brittle test assertions. Remediation: tighten reviewer trust/noise rules, calibrate reviewer severity thresholds, and engage human escalation via ping-pong caps.
   - **Feedback Loop Stagnation**: A downstream processing routine (e.g. measurement loop, verification, triage) records 0 intake (`filed: 0`) across $\ge 2$ consecutive runs while upstream PRs merge or roadmap/feature issues close in the same window. Trigger: overly broad or qualitative discovery sweeps that falsely claim all items are covered. Remediation: mandate deterministic per-issue matching tables and itemized reconciliation against upstream closed issues/PRs.
   - **Passive Order-Taking Anomaly ("Yes-Man Blindspot")**: The Ambiguity Gate trigger rate across intake runs in `autowork` or `triage` is <5% despite elevated PR review bounces ($\ge 2$) or high iteration usage ($\ge 35$), indicating agents are silently guessing requirements and building flawed implementations rather than interrogating underspecified issues. Trigger: agents defaulting to compliance over inquiry. Remediation: tighten Step 12 criteria in `autowork.md` and `triage.md` to force explicit questions on ambiguous terms, and feed problem cases into the automated ambiguity benchmark eval suite.
   - **Speculative Runaway Waste**: An agent run consumed >50k tokens on an underspecified issue with 0 clarifying questions asked, and subsequently failed, bounced, or required post-merge rework. Remediation: tighten ambiguity gate checks and export the failing issue into the automated benchmark eval dataset.
3. **Automated Remediation PRs & Benchmark Evals**: The optimizer automatically drafts targeted PRs—locally for repo-specific rules/configs, or upstream via `npx jonah-fleet contribute` for fleet-wide prompt/workflow improvements—and appends failure fixtures to the automated benchmark eval suite.

---

## Autonomous Issue Synthesis

How external and human contributor pull requests are reconciled into the issue tracker without manual friction or reviewer bounces:

1. **Zero-Friction Contribution**: External human contributors often submit PRs directly without opening an issue first. Forcing contributors to open tracking issues or bouncing clean PRs causes friction, review thrash, and abandonment.
2. **Autonomous Synthesis on Merge**: When `peer-review.md` approves a pull request lacking a `Closes #N` link, the review routine automatically synthesizes a tracking issue before merging:
   - Creates a tracked issue via `gh issue create` capturing the PR title, body, and deliverables.
   - Appends `Closes #<synthesized_issue_id>` to the PR description via `gh pr edit`.
3. **Audit & Single-Flight Lineage**: When the PR is squash-merged, `peer-review` explicitly closes the tracking issue (`gh issue close <ISSUE_NUMBER>`) to guarantee tracking closure, even when bot credentials or draft PR states bypass GitHub's native issue auto-close. This maintains 100% issue auditability, project board tracking, telemetry metrics, and release changelogs without leaving stray open issues.

---

## Fleet Telemetry & Weekly Token Economics

Cross-repository telemetry aggregation and token tracking protocol:

1. **Lightweight Routine Telemetry**: Every autonomous routine log (`.github/prompts/logs/*/*.md`) emits a structured `RoutineTelemetrySummary` capturing routine identity, duration, iterations, result, failure category, cost, and tokens.
2. **Opt-in Emission Step**: GitHub Actions workflows (`autowork-cron.yml`, `trigger-review-routine.yml`, `prompt-optimizer-cron.yml`) run `jonah-fleet telemetry --emit` using optional `JONAH_FLEET_TELEMETRY_ENDPOINT` secrets.
3. **Global 70% Budget Ceiling**: Tracks rolling 7-day spend across all fleet repositories against the global ceiling (~8.75M tokens/week).
4. **Health Thresholds**:
   - `[HEALTHY]`: < 70% of weekly budget ceiling.
   - `[WARNING]`: 70% – 90% of weekly budget ceiling.
   - `[CRITICAL]`: 90% – 100% of weekly budget ceiling.
   - `[EXCEEDED]`: > 100% of weekly budget ceiling.

---

## Peer Review Resilience & Orphaned PR Recovery

How the fleet guarantees continuous review throughput, recovers from transient API quota exhaustion or runner crashes, and prevents pull requests from stalling indefinitely:

1. **Failure Trapping & Transparency**: When a peer-review workflow session encounters an execution failure (e.g. LLM API rate limit / quota exhaustion or runner timeout), `trigger-review-routine.yml` traps the failure and posts an informational status notice on the PR. Failures are made immediately visible on the PR timeline rather than silently failing in the background.
2. **Periodic Scan Sweep (Watchdog)**: `trigger-review-routine.yml` runs a scheduled 2-hour cron sweep (`cron: '45 */2 * * *'`) in Scan mode. Any open PR in `ready_for_review` state that was orphaned due to a transient API rate limit or missed event trigger is automatically picked up, evaluated, and resolved.
3. **Interactive Re-triggering**: Any team member or author can immediately re-dispatch review by commenting `/review`, `/peer-review`, `/retrigger`, or `/re-review` on any open pull request, or manually triggering `trigger-review-routine.yml` via `workflow_dispatch`.
4. **Autowork Phase 1 Watchdog**: During Phase 1 convergence, Autowork actively identifies open ready PRs that have received no review feedback for $>2$ hours, re-triggering review via draft toggle or `/review` comment before picking up new work. Review re-triggering is strictly conditioned on all CI checks having passed (`conclusion: SUCCESS`, `mergeStateStatus: CLEAN`) and is strictly prohibited if checks are in-progress or awaiting approval (`ACTION_REQUIRED`).

---

## Upstream Symphony & Funes Intel & Architectural Evaluation Framework

How changes and innovations from upstream ecosystems—[openai/symphony](https://github.com/openai/symphony) for issue-tracker orchestration and [huggingface/funes](https://github.com/huggingface/funes) for agent memory & session indexing—are systematically audited and evaluated for incorporation into Jonah Fleet:

1. **Automated Ecosystem Radar (`symphony-radar.yml`)**: A weekly scheduled workflow runs `.github/scripts/fetch-symphony-radar.js` to inspect upstream commits, specification updates (`SPEC.md`), and releases across `openai/symphony` (orchestration) and `huggingface/funes` (memory tooling), generating an actionable digest issue in Jonah Fleet.
2. **The 4 Evaluation Layers**:
   - **Layer 1 (Zero-Daemon Invariant)**: Can the enhancement execute in ephemeral GitHub Actions and `agy` CLI sessions without requiring a 24/7 background server or persistent WebSocket?
   - **Layer 2 (Issue Tracker Abstraction)**: Does the pattern map cleanly to native GitHub Issues, labels, and PR checks without proprietary tracker dependencies?
   - **Layer 3 (Token & Cost Economy)**: Does the change optimize LLM spend within Jonah Fleet's 70% weekly token ceiling (~8.75M tokens)?
   - **Layer 4 (Multi-Repo Portability)**: Can the routine or skill be distributed via `agents-manifest.json` and `jonah-fleet sync` across any consumer repository?
3. **Agent Memory & Session Indexing Evaluation Dimensions (Funes Watch)**:
   - **Zero-LLM Ingestion**: Deterministic parsing of agent session traces (`.jsonl`/Parquet) into LanceDB without spending LLM tokens from the weekly budget.
   - **Pull-Based Memory Delivery**: Memory served strictly on demand via MCP (`recall`, `get`) to prevent prompt context bloat.
   - **Cross-Session Provenance**: Verbatim turns and provenance retention instead of lossy summary drift.
   - **Multi-Agent Portability**: Standardized trace ingestion across Antigravity CLI (`agy`), Claude Code, and Codex.
4. **Classification & Action Protocol**:
   - **🟢 Category A (Adopt Directly)**: Security guardrails, claim lock invariants, reader/writer rules, prompt engineering optimizations, deterministic zero-LLM indexing.
   - **🟡 Category B (Adapt to Actions/CLI)**: Dynamic orchestrator pacing, backpressure controls, multi-stage review checks, pull-based memory MCP integrations.
   - **🔴 Category C (Skip)**: Elixir/OTP supervision trees, BEAM memory tuning, proprietary runtime internals, always-loaded memory context dumps.

---

## Post-Measurement Product Bridge & Intent vs. Defect Guardrail

How closed-loop feedback from product telemetry and measurement trackers drives product decisions while preventing autonomous agents from falling into telemetry rabbit holes:

1. **Mandatory Post-Measurement Action Rule**: When `analytics-review` concludes an evaluation of a feature or experiment tracker (especially sub-threshold features with <2% user adoption or >50% failure rates), it MUST emit a structured directive: `RECOMMENDATION: [PIVOT | DEPRECATE | ITERATE]`. Measurement closure is never a terminal dead-end; outcomes are staged into the active `🗺️ Product Plan` or actionable `roadmap/*` issues.
2. **Feature Pruning & Deprecation Audit**: During Propose mode sweeps, `product-planning` actively audits shipped roadmap items and closed measurement trackers. For features with low ROI (<2% adoption, >50% error/failure rate), it drafts explicit deprecation, removal, or simplification proposals alongside new feature additions, keeping the codebase and UI lean.
3. **Intent vs. Defect Guardrail**: When investigating underperforming or zero-conversion features, `autowork` and `diagnosing-bugs` verify whether the issue is a software defect or a lack of user intent. If the feature functions properly without runtime errors but user interaction is negligible, agents must classify the issue as a **product/UX intent question** (`needs-design` / `roadmap/*`) rather than falling into the **Telemetry Rabbit Hole** (adding redundant fallback telemetry, defensive error handling, or retry loops for unwanted features).

---

## Priority-Driven Dual Agent Execution (GitHub Actions + Local Agents)

How agent routines are partitioned between cloud GitHub Actions (24/7 cloud runners for fast time-to-resolution) and local machine agents (`jonah-fleet run` / `jonah-fleet daemon` for zero cloud quota consumption):

1. **Priority Routing Rules**:
   - **`priority/P0` & `priority/P1` & Bugs**: Processed immediately by cloud GitHub Actions upon event trigger (`issues`, `pull_request`, `schedule`).
   - **`priority/P2` & `priority/P3` (Lower Priority)**: Handled primarily by local machine agents in isolated Git worktrees. Cloud Actions skips immediate event triggers on P2/P3 items to conserve Actions quota.
   - **Cloud Catchup Sweep (48h Fallback)**: If a P2/P3 issue or PR remains unclaimed/unreviewed for $>48\text{ hours}$ (e.g. because local machines were offline), the scheduled cloud Actions scan sweep automatically picks it up to prevent work starvation.
2. **PR Priority Mirroring**: When Autowork opens a PR, it automatically mirrors the parent issue's priority labels (`priority/P0`..`P3`) onto the pull request so downstream review workflows can filter triggers without extra API overhead.
3. **Workspace Isolation via Git Worktrees**: Local agents execute inside ephemeral worktrees (`.jonah-fleet/worktrees/<routine>-<issue>`) off `origin/main`, ensuring active editor sessions, uncommitted changes, and local branches are never modified or disturbed.
4. **Local Claim Protocol**:
   - Local agent issue claims post: `🔒 Claimed by local autowork session (host: <hostname>) <timestamp>`.
   - Local agent PR convergence claims post: `🔒 Addressing review findings by local autowork session (host: <hostname>) <timestamp>`.
   - Local processes trap `SIGINT`/`SIGTERM` to unassign claims and remove worktrees cleanly on exit.
   - Standard stale-claim rules (6h for issues, 2h for PRs) safely reclaim orphaned local claims if a machine powers down unexpectedly.
