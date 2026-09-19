# Issues Housekeeping

<!--
================================================================================
TIER 1: STATIC INVARIANT PREFIX
Routine objective, Definition of Done, constraints, instructions, and logging.
100% cacheable across all runs and repositories.
================================================================================
-->

## Objective

Sweep all open issues for staleness, duplicates, batch-consolidation opportunities (sets of small related issues addressable together), label drift, priority accuracy, dependency status, and orphaned autowork claims, and land any accumulated draft log-only PRs. Fix what can be fixed and post a summary of changes made.

## Definition of Done

The run is SUCCESS only if ALL of these are true:

- [ ] All open issues have been scanned
- [ ] Priority review completed: P1s re-evaluated, quick-win promotions considered, priority rubric enforced
- [ ] Duplicate & batch-consolidation check completed: overlapping issues closed with cross-references, small related issues consolidated
- [ ] Stale / obsolete check completed: premise-obsolete issues closed, idle issues resolved
- [ ] Label audit completed: every open issue has consistent type, size, and priority labels
- [ ] Dependency check completed: issues with `## Dependencies` verified against blocker status
- [ ] Orphaned-claim sweep completed: stale autowork claims (per `ORCHESTRATION.md`) released back to the unclaimed pool
- [ ] Stalled routine run audit completed: routine log issues in `status:running` older than 6 hours marked as `status:failure` (timed_out)
- [ ] Summary posted listing all changes made

If any criterion cannot be met, stop immediately and log FAILURE with the reason.

## Constraints

- **Max iterations**: 40 — after 40 tool call rounds without completing Definition of Done, STOP. Log FAILURE with category `token_limit`.
- **Max scope**: housekeeping only. Do not implement code fixes or open feature PRs.
- **No speculative work**: only modify issue metadata (labels, status, comments, releasing stale assignees, reconciling stalled routine runs).
- **Language Requirement**: All GitHub issue titles, descriptions, task checklists, and comments MUST be written in **English**.

## Instructions

### Phase 1: Quick Recovery & Clearing

1. **Stalled routine run sweep**: Check open issues with labels `routine-log` and `status:running`. If an issue has been in `status:running` for > 6 hours without updates, add label `status:failure`, remove `status:running`, add label `needs-attention`, and comment noting the runner timeout or crash.
2. **Orphaned-claim sweep**: Sweep assigned issues. If an issue meets the 3 stale-claim conditions in `ORCHESTRATION.md` (autowork claim comment, no open PR, comment > 6 hours old), re-read immediately before writing, unassign the dead owner, and post a release comment.

### Phase 2: Backlog Hygiene

3. **Priority review**: Check open P1/P2/P3 issues. Promote critical bugs or unblocked items; demote items that lack immediate priority.
4. **Duplicate & consolidation check**: Identify duplicate issues; close duplicates with cross-references. Consolidate small, related micro-tasks into batch issues.
5. **Premise-obsolete & stale check**: If an issue's premise was resolved by already-merged PRs or recent refactors, close as completed with evidence.
6. **Label audit & safe prune**: Ensure open issues carry standard role labels (`needs-triage`, `ready-for-agent`, `needs-human`, etc.). Use `/triage` if classifying incoming issues. Whenever applying `needs-human` or `needs-info` to escalate an ambiguous, stale, or infeasible issue, mandate formatting the escalation comment with the 4-part card:
   ```markdown
   ## 🛑 Escalation: Human Decision Required
   - **Decision Needed**: [1 focused question or choice]
   - **Evidence ("Why I believe this")**: [Specific files, lines, test outputs, or conflicting docs]
   - **Evaluated Options & Trade-offs**:
     - *Option A*: [Pros / Cons]
     - *Option B*: [Pros / Cons]
   - **Recommended Path**: [Agent recommendation]
   ```
   Run `npx --yes jonah-fleet labels prune --yes` (or `jonah-fleet labels prune --yes`) to safely prune strictly unused boilerplate labels (`issues: 0`, `pullRequests: 0`, non-protected taxonomy) without deleting historical or fleet taxonomy labels.
7. **Closed-loop verification check**: For projects running impact or verification loops, audit recently closed roadmap/feature issues against tracking issues to ensure shipped levers do not remain untracked.

### Phase 3: Summary

8. Post a summary comment or log recording all actions taken (priority shifts, closed duplicates, released claims, reconciled stalled runs).

## Logging

After completing (SUCCESS or FAILURE), record run execution details to `.jonah-fleet/run-report.md`. Include:
- Prompt SHA
- Tally of issues audited, claims released, stalled runs reconciled
- List of closed or modified issues

**Issue Logging Protocol**:
- Record run execution details to `.jonah-fleet/run-report.md` (or update `$ROUTINE_ISSUE_NUMBER`).
- Follow the Routine Issue Logging & Telemetry Protocol in `ORCHESTRATION.md`. Never commit run logs to git branches.

<!--
================================================================================
TIER 2: SEMI-STABLE PROJECT RULES
Repository rules from AGENTS.md, manifest configurations, and LESSONS.md.
Cacheable across consecutive runs within the same repository.
================================================================================
-->

## Repository Rules & Project Context (Tier 2)

In this tier, Issues Housekeeping ingests semi-stable repository conventions, operational memory, and configuration rules that change infrequently across consecutive runs in the same repository:

1. **Repository Conventions (`AGENTS.md`)**: Read `AGENTS.md` (or `CLAUDE.md` / `GEMINI.md`) for issue taxonomy, allowed labels, and escalation rules.
2. **Operational Memory (`LESSONS.md`)**: Ingest active operational gotchas to ensure issue triage preserves known project constraints.
3. **Fleet Manifest (`agents-manifest.json`)**: Ingest enabled routines and presets to audit active routine log issues.
4. **Engineering Skills (`.agents/skills/`)**: Leverage `triage` and `grill-me` when clarifying or categorizing ambiguous issues.

<!--
================================================================================
TIER 3: DYNAMIC TAIL PAYLOAD
Target issue / PR data, git diff, active branch, timestamps, and runtime vars.
Appended strictly at the tail of the prompt to preserve prefix cache validity.
================================================================================
-->

## Dynamic Context & Execution Payload (Tier 3)

The dynamic execution context for this housekeeping sweep is injected strictly at the tail of the prompt:

- **Open Issues Snapshot**: List of open issues, labels, assignees, and timestamps.
- **Runtime Metadata**: `$ROUTINE_ISSUE_NUMBER`, `$GITHUB_RUN_ID`, and runner timestamp.
- **Prefix Caching Invariant**: Harnesses and runners MUST NEVER interpolate dynamic timestamps, run IDs, or target identifiers into Tier 1 or Tier 2 prefix blocks.

