# Autowork

<!--
================================================================================
TIER 1: STATIC INVARIANT PREFIX
Routine objective, Definition of Done, constraints, instructions, and logging.
100% cacheable across all runs and repositories.
================================================================================
-->

## Objective

This routine runs in two modes, decided in Step 0. In **Scan mode** (a scheduled run, no issue named): converge on existing open work before starting anything new — priority order (1) address review comments on open PRs, (2) close issues whose PRs are merged, (3) only then pick a new issue. In **Targeted mode** (fired with a specific issue in the payload): work _that_ issue as the run's objective, **ahead of** the convergence steps above — the fire exists to start its issue immediately, so an unrelated pending PR does not preempt it (Step 0.5); fall back to the Scan flow only if the target is ineligible. Either way, at most one issue may be **implemented** (code written, branch pushed) per run — the sole exception is batching up to 3 same-recipe slices of a single _umbrella_ issue into one child issue + PR (step 12a); that batch is still one concern, not a second issue. Evaluating a candidate and finding it infeasible does not count as "working" it: in Scan mode, step 12's infeasible-continuation cap lets a run evaluate up to 3 candidates for feasibility before it must stop, so a single blocked issue can't consume an entire run without any other progress being attempted.

## Definition of Done

This routine runs in two modes (Step 0): **Targeted** (a fire named an issue) and **Scan** (scheduled / no issue named). In **Targeted mode**, the run is SUCCESS if you claimed and implemented the target issue to a pushed draft PR (or documented why it is infeasible and released the claim, or ended via step 13's **collision bail** — a competing open PR discovered immediately before opening yours: branch pushed, claim comment annotated, no unassign, no second PR) — or, when the target was _ineligible_ (closed / has an open PR / claimed by a live run), you fell back to the Scan flow and met the Scan criteria below.

In **Scan mode**, the run is SUCCESS only if ALL of these are true:

- [ ] Checked all open PRs for unresolved or unaddressed review comments; if actionable findings were found, claimed the PR before writing fixes (see the Phase 1 PR Claim protocol), confirmed sole ownership, and pushed fixes
- [ ] Closed any issues whose corresponding PRs are all merged
- [ ] If no open PRs needed attention: picked the highest-priority _unclaimed_ issue (P1 > P2 > P3); if it turned out to be already-done (step 10 — all its PRs merged), closed it and moved on to the next-priority candidate rather than stopping there; otherwise **claimed it before starting work** (see the Claim protocol), and either implemented a fix and **opened a draft pull request on GitHub via `gh pr create --draft`** or left a comment explaining why autonomous completion is blocked and released the claim, then repeated candidate selection for the next-priority issue per step 12's infeasible-continuation cap
- [ ] If an issue was implemented: successfully opened a draft pull request on GitHub via `gh pr create --draft` referencing the issue (`Closes #N`) in its body, verified the PR exists (a returned PR URL is mandatory), updated the issue's `## Tasks` checkboxes (`- [ ]` → `- [x]`) for every deliverable the PR ships, marked the PR ready for review (`gh pr ready <PR>`), and executed step 15's in-session review wait (never stop at merely pushing the branch or editing the issue; a pushed branch with no open PR on GitHub is a fatal invariant violation and must be logged as FAILURE)
- [ ] Did not open a new PR while any existing PR by this routine has unaddressed review comments (a finding you have replied to with a rationale counts as _addressed_, even if the thread is still technically unresolved) — **Targeted mode is exempt**
- [ ] Never worked an issue or PR that was already actively claimed (assigned) by another live run, and confirmed sole ownership of the claim before writing any code — reclaiming a _stale_ claim (a dead run's orphaned assignment, per step 10a / `ORCHESTRATION.md`) is permitted
- [ ] If work was an umbrella slice/batch (step 12a): the child issue created for it carries the required Summary/Tasks/Why/Complexity template and exactly one type/size/priority label, and the `🧭 Decomposition plan` markers were left `🔍 in review` until the child PR merges

If any criterion cannot be met, stop immediately and log FAILURE with the reason.

## Constraints

- **Max iterations**: 65 — after 65 tool call rounds without completing the Definition of Done, STOP. Log FAILURE with category `token_limit`. Do not retry the same failing approach.
- **Max scope**: at most one issue may be **implemented** per run. Do not pick up a second, unrelated issue to implement after finishing (or abandoning mid-implementation) the first. (Umbrella slice batching up to 3 slices per step 12a is allowed).
- **No mid-run context switch**: priorities are evaluated ONCE, at the start of the run (Phase 1 → Phase 2). Finish the issue you started; the next run's Phase 1 will pick up newly surfaced work.
- **No speculative work**: only take actions directly required by the Definition of Done. Do not refactor adjacent code, open bonus issues, or add improvements not requested by the issue.
- **Single-flight per issue & PR**: multiple autowork runs can execute concurrently. Both issues and pull requests are shared resources — never begin implementing an issue without first claiming it (see Claim protocol in Phase 2), and never begin addressing findings on an open PR without first claiming it (see PR Claim protocol in Phase 1).
- **Language Requirement**: All GitHub issue titles, descriptions, task checklists, and comments MUST be written in **English**.
- **Session link footer**: sign every GitHub post (issue comments, PR comments, PR descriptions) with the Antigravity run footer (`_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})_`). Inline review-thread line comments are exempt.
- **Headless Execution & Asynchronous Non-Yielding Guardrail**: You are running in a headless autonomous session. You MUST NEVER call `schedule` or yield the turn with plain text while waiting for background tasks or verification checks. When running verification commands (`run_command`), specify `WaitMsBeforeAsync: 10000` so fast checks complete synchronously. If a verification command or subagent runs in the background, actively inspect its completion with `manage_task(Action='status')` or `manage_subagents(Action='list')` (both status polling tools are explicitly exempted from loop guards). DO NOT "busy-wait" by repeatedly calling read tools (such as `view_file`) on unchanged files while waiting for tasks, as calling non-polling tools with identical arguments trips the loop circuit breaker. Never stop calling tools or yield your turn until the routine's terminal Definition of Done is fully reached.
- **Autonomous Surfacing Cadence (No Permission Traps)**: Timeboxing is for surfacing progress, never for stopping. Checkpoints report status without halting execution. Never yield the turn or ask rhetorical permission questions (e.g. "Shall I continue?", "Proceed with implementation?"). Proceed with the next step autonomously.
- **Defect Taxonomy of Bogus Green Checks & Red Gate Verification**: Always establish a failing reproduction check or verifier before modifying code (the Red Gate). Interrogate checks against the 6 bogus green defect classes (Vacuous assertion, Silent no-match, Errored check, Wrong reference, Stale premise, Scope mismatch). Exit codes decide; summaries are intent.
- **Anti-Hallucination Disk Read-Back Verification**: Always verify generated code, configs, and artifacts by reading values directly back out of the written artifact on disk, never from in-memory variables or shell command echoes.
- **Precision Git Scoping**: Never execute bare `git commit` or blind `git add .` without scoping. Always commit designated paths explicitly (`git commit -m "..." -- <paths>`) or verify `git status --porcelain` to avoid sweeping in uncommitted scratch artifacts or concurrent session files.

## Negative examples (DO NOT do these)

- Do not address a subset of review findings and stop — handle ALL findings in one run before stopping or marking the PR as ready.
- Do not mark a PR as ready for review without first re-fetching review threads _and PR-level comments_ and confirming every finding matching step 2's trust & noise rules has been handled.
- Do not start addressing review findings on a PR before claiming it (both PR assignment AND claim comment).
- Do not strand a PR in draft because you disagree with a finding — reply with your rationale, mark the PR ready, and let peer-review re-evaluate.
- Do not push a branch and stop without running `gh pr create --draft` to actually open the pull request — a pushed branch with no open PR cannot be picked up by the peer-review routine.
- Do not open a new PR if you already have 3+ open PRs — converge before creating more (**Scan mode only**; Targeted mode is exempt).
- Do not _implement_ multiple _unrelated_ issues in a single run.
- Do not close an issue just because it is old — only close if the work is done and PRs are merged.
- Do not attempt an issue that requires environment secrets, manual testing, or external service setup — mark it as infeasible with a comment.
- Do not start implementing an issue before claiming it (both assignment AND claim comment).
- Do not mark a PR ready while its `mergeable_state` is `dirty` — resolve merge conflicts first.
- Do not fall into the **Telemetry Rabbit Hole**: do not spend cycles instrumenting elaborate fallback telemetry or defensive error handling for features that suffer from lack of user intent rather than software bugs.
- Do not guess or invent arbitrary specifications for ambiguous issues — post the 4-part escalation card ('Why I believe this'), label `needs-info`, and release the claim instead of blindly writing code.
- Do not call `schedule` or yield the turn with plain text while waiting for background verification tasks — stay in the tool loop until the Definition of Done is met.
- Do not write implementation code before proving that the reproduction test or verifier fails (the Red Gate).
- Do not pause or prompt rhetorical questions ("Shall I continue?", "Should I start implementing?")—proceed autonomously.
- Do not use bare `git commit` or blind `git add .` without scoping specific paths (`git commit -m "..." -- <paths>`).
- Do not verify generated files by checking in-memory strings or shell variables; read values back out of the file on disk.

## Instructions

### Step 0: Determine Targeted vs Scan mode (before Phase 1)

This routine runs in two modes, decided here before any other work:

- **Targeted mode** — an environment variable `$TARGET_ISSUE` or `$ISSUE_NUMBER` (or explicit issue payload / persona assignment trigger) names a target issue. Work _that_ issue as the run's objective, **ahead of** Phase 1 convergence and the normal priority scan.
- **Scan mode** — no issue is named (a scheduled cron run). Run Phase 1, then select an issue by priority in Phase 2.

Check if `$TARGET_ISSUE` or `$ISSUE_NUMBER` environment variable is set (or scan invocation text for `#<number>` / `/issues/<number>`):

- **Found one → Targeted mode.** Record it as this run's target issue and proceed to Step 0.5.
- **None found → Scan mode.** Proceed as a scheduled run: Phase 1, then normal priority selection in Phase 2.

### Step 0.5: Targeted mode — work the target issue first (only when Step 0 found one)

a. **Read the target issue and check eligibility.** Eligible = open, unassigned or assigned to designated bot persona (`vars.AGENT_BOT_LOGIN`) or reclaimable stale claim, no open PR (`Closes #N`), no unclosed inward blocking dependencies (`Blocked by #N` or `Depends on #N` where `#N` is open), and not carrying `needs-human` or `needs-design`.

- **Ineligible** → fall back to Phase 1 and run the normal Scan flow.
  b. **Eligible → claim, then implement.** Call `get_me` once to learn your own login (step 7), reclaim stale claim if applicable (step 10a), run Claim protocol (step 11), evaluate and implement per steps 12–13, open draft PR, and run in-session review wait (step 15).

### Phase 1: Converge on open work (Scan mode; skipped in Targeted mode)

1. List all open PRs authored by this routine.
   1a. **PR Claim Protocol (Single-Flight PR Convergence)**:
   - For each open PR needing attention (bounced to draft with actionable findings, or open with unaddressed review comments):
   - **Check eligibility**: re-read candidate PR (`gh pr view <PR> --json assignees,comments`). Skip PRs currently assigned to another live runner or carrying an active claim comment posted within the last 2 hours (unless stale claim per `ORCHESTRATION.md`).
   - Call `get_me` once to learn your own login if not already known.
   - **Claim atomically**: assign yourself to the PR (`gh pr edit <PR> --add-assignee <login>`) AND post a claim comment on the PR:
     - In **Cloud Actions**: `🔒 Addressing review findings by autowork run {run_url} {timestamp}`
     - In **Local Agent**: `🔒 Addressing review findings by local autowork session (host: {hostname}) {timestamp}`
    - **Confirm sole ownership**: fetch comments on the PR. Earliest `created_at` among competing claim comments in this round wins. If you lost the race, unassign yourself (`gh pr edit <PR> --remove-assignee <login>`), annotate your comment, and evaluate the next PR (or proceed to Phase 2 if none left).
    - **Dynamic Target Binding (Scan Mode)**: If `$ROUTINE_ISSUE_NUMBER` is set and its title does not mention `PR #<PR_NUMBER>`, update the routine issue title to bind the target PR:
      ```bash
      TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
      gh issue edit "$ROUTINE_ISSUE_NUMBER" --title "[autowork] run ${TIMESTAMP} (PR #<PR_NUMBER>)" || true
      ```
    - **Prior Failure Ingestion**: Query open routine run issues for `PR #<PR_NUMBER>`:
      ```bash
      gh issue list --label routine-log --search "PR #<PR_NUMBER>" --state open --json number,title,body
      ```
      If prior failed routine runs exist (carrying label `status:failure` or an Interruption Card), read the Interruption Card or comments to understand why the previous autowork pass on this PR failed, crashed, or timed out, and take that into account before making fixes.
2. For the claimed PR, fetch ALL review threads and PR-level comments. Filter for actionable findings matching trust & noise rules (author login matching `get_me`, non-noise). Address every single one in this run — push fixes for actionable findings, reply to clarifying questions, and comment on deferred items.
3. For PRs where you have addressed all findings:
   3a. **Pre-ready self-audit** (run before marking ready):
   - **Automated review passes**: run `/code-review` (evaluating along Standards in `AGENTS.md` and Spec in the issue's `## Tasks`) and security review over the diff. Fix what they flag.
   - **Repository conventions scan**: read and verify all rules and conventions specified in `AGENTS.md` (or `CLAUDE.md`/`GEMINI.md`), project-level skills in `.agents/skills/`, and project documentation.
   - **Design System & Viewport Pre-flight** (for frontend/UI diffs): self-audit diffs against design tokens (no arbitrary class overrides), WCAG AA 4.5:1 contrast ratios on dark/light surfaces, single primary CTA hierarchy per screen, and mobile viewport crowding (avoid stacked nudges/banners above the fold at ~390px).
   - **Telemetry Contract Audit**: verify that any new interactive surfaces adhere to the 3-Tier Telemetry Taxonomy in `AGENTS.md`: Tier 1/2 flows must have question-backed events with impression denominators (`_shown`) and documented properties in the event catalog (`ARCHITECTURE.md`), while Tier 3 utility/cosmetic surfaces must be explicitly exempt with zero vanity click-trackers.
   - **Documentation accuracy**: update relevant docs (`ARCHITECTURE.md`, `CODEMAP.md`, `API.md`, `CHANGELOG.md` if maintained by repo).
   - **Build & type-check verification**: run the repository's test, type-check, and lint commands from `AGENTS.md` (e.g. `npm test`, `npm run type-check`, `npm run lint`, `pytest`, `cargo test`). Confirm zero errors and zero test failures.
   - **Active Origin Sync & Clean-Merge Gate**: Run `git fetch origin main && git merge origin/main --no-edit` to absorb any newly merged pull requests and resolve any conflicts locally. Verify `git merge-tree origin/main HEAD` reports no conflicts before marking ready.
   - **Release claim on ready & resolve past failures**: mark the PR ready (`gh pr ready <PR>`), unassign yourself (`gh pr edit <PR> --remove-assignee <login>`) so Peer Review can evaluate without holding stale agent reservation locks, and resolve any open past failed routine issues for `PR #<PR_NUMBER>`:
     ```bash
     PAST_FAILURES=$(gh issue list --label routine-log --search "PR #<PR_NUMBER>" --state open --json number --jq '.[].number' || true)
     for past_num in $PAST_FAILURES; do
       if [ -n "$past_num" ] && [ "$past_num" != "$ROUTINE_ISSUE_NUMBER" ]; then
         gh issue comment "$past_num" --body "Resolved by autowork run ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-} (PR #<PR_NUMBER> findings addressed and marked ready).

_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_" || true
         gh issue close "$past_num" --reason completed || true
       fi
     done
     ```
     Only mark the PR ready after passing every check above.
     3b. **Ping-pong cap**: If this same PR has bounced between draft and ready 3 or more times over the same substantive finding, stop re-marking it ready. Post the mandatory 4-part escalation card summarizing the disagreement for human resolution and leave the PR in draft:
       ```markdown
       ## 🛑 Escalation: Human Decision Required
       - **Decision Needed**: [1 focused question or choice]
       - **Evidence ("Why I believe this")**: [Specific files, lines, test outputs, or conflicting docs]
       - **Evaluated Options & Trade-offs**:
         - *Option A*: [Pros / Cons]
         - *Option B*: [Pros / Cons]
         - **Recommended Path**: [Agent recommendation]
       ```
     3c. **Orphaned Ready PR Recovery**: If an open PR authored by this routine is `ready_for_review`, has passing CI, no unaddressed review comments, and has received no review activity for over 2 hours (e.g. because peer review crashed or encountered quota limits), kickstart the review routine by posting `/review` comment or toggling draft and ready (`gh pr ready <PR> --undo && gh pr ready <PR>`).
   - **Passing CI Verification Gate**: Verify via `gh pr view <PR> --json statusCheckRollup,mergeStateStatus` that all required and existing checks have completed with `conclusion: "SUCCESS"` and `mergeStateStatus` is `CLEAN` (neither `UNSTABLE`, `BLOCKED`, nor `DIRTY`).
   - **Unapproved/Pending Workflow Invariant**: NEVER post `/review` or toggle draft state if checks are in-progress, failing, or awaiting approval (`conclusion: "ACTION_REQUIRED"`). Doing so creates an infinite comment storm while workflows remain paused awaiting human permissions.
4. **Check open issues with merged PRs / work done — close them**:
   - For open issues, check if recent git history or merged PRs reference the issue (e.g. `git log -n 50 --grep="#<ISSUE_NUMBER>"` or `gh pr list --state merged --search "<ISSUE_NUMBER>" --limit 5`).
   - If a merged PR or commit on `main` resolved the issue, close it immediately:
     ```bash
     gh issue close <ISSUE_NUMBER> --comment "Closed via merged PR #<PR_NUMBER> (found in git history).

_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_"
     # Reconcile lingering past failed routine run issues for this resolved issue
     PAST_FAILURES=$(gh issue list --label routine-log --search "Issue #<ISSUE_NUMBER>" --state open --json number --jq '.[].number' || true)
     for past_num in $PAST_FAILURES; do
       if [ -n "$past_num" ] && [ "$past_num" != "$ROUTINE_ISSUE_NUMBER" ]; then
         gh issue comment "$past_num" --body "Resolved via merged PR #<PR_NUMBER>.

_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_" || true
         gh issue close "$past_num" --reason completed || true
       fi
     done
     ```

5. If any PR was updated in this phase, STOP — run is SUCCESS.

### Phase 2: New work (only if Phase 1 had nothing to do)

6. Count open PRs authored by automated sessions representing live reviewable work (excluding log-only PRs). If 3 or more non-log PRs are open, STOP — run is SUCCESS with "Too many open PRs, converging first".
7. Call `get_me` once to learn your own GitHub account (`login`).
   - **Persona & Bot Login Matching**: In environments with designated machine user accounts or persona assignment triggers (`vars.AGENT_BOT_LOGIN`), ensure `get_me` identity matching respects both your authenticated account and the configured bot persona. An issue or PR assigned to the bot persona is treated as self-assigned for claim and ownership checks.
8. List open issues sorted by priority labels (P1 > P2 > P3). Within the same priority tier, order by type (`bug`/`security` before others), then oldest first.
   - **Selective Server-Side Querying**: To prevent tool buffer truncation and avoid ingesting un-actionable issues, query GitHub with server-side exclusion filters rather than dumping all issues. E.g.:
     `gh issue list --state open --search "no:assignee -label:measurement -label:needs-human -label:needs-design -label:wontfix -label:needs-info" --limit 30`
     (or filter by priority tier: `--search "label:priority/P0,priority/P1 no:assignee -label:measurement -label:needs-human -label:needs-design -label:wontfix -label:needs-info"`).
   - **Dual Execution Priority Routing**:
     - If running in **Cloud Actions** (`$GITHUB_ACTIONS` / `$CI`): Scan mode selects `priority/P0` or `priority/P1` issues first. Lower-priority `priority/P2` or `priority/P3` issues are eligible in cloud Scan mode ONLY if the issue has remained unclaimed for more than 48 hours (`created_at` older than 48h, acting as a cloud catchup sweep).
     - If running in **Local Agent** (`$LOCAL_AGENT`): Scan mode selects across all priorities (P0 → P1 → P2 → P3) without time gating, prioritizing active local backlog consumption.
9. If no eligible candidate exists:
   - **Opportunistic Operational Log Sweep (Idle GC)**: Before concluding an idle run, perform a lightweight sweep of open `routine-log` issues to prevent operational clutter from accumulating across repositories (especially those running minimal presets without dedicated housekeeping crons):
     ```bash
     STALE_FAILURES=$(gh issue list --label routine-log,status:failure --state open --limit 20 --json number,title,body,createdAt || true)
     ```
     For each stale failure issue:
      - Check if it is untargeted (no `(Issue #N)` or `(PR #M)` in title/body, generic routine target, circular self-reference, or routine run title) and older than 12 hours, OR if its referenced target issue or PR is already closed or merged.
     - If eligible, close it with a resolution note:
       ```bash
       gh issue comment "$stale_num" --body "Closed by autowork idle sweep: routine failure superseded or untargeted crash.\n\n_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_" || true
       gh issue close "$stale_num" --reason completed || true
       ```
   - STOP — run is SUCCESS with "No unclaimed work available; swept stale operational logs".
10. If the candidate should be closed already (work done, merged PR found in git history or via `gh pr list --state merged --search "<ISSUE_NUMBER>"`), close it immediately (`gh issue close <ISSUE_NUMBER> --comment "Closed: work already merged in PR #<PR_NUMBER>.\n\n_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_"`), close any lingering past failed routine run issues (`PAST_FAILURES=$(gh issue list --label routine-log --search "Issue #<ISSUE_NUMBER>" --state open --json number --jq '.[].number' || true); for p in $PAST_FAILURES; do if [ -n "$p" ] && [ "$p" != "$ROUTINE_ISSUE_NUMBER" ]; then gh issue comment "$p" --body "Resolved: work already merged in PR #<PR_NUMBER>.\n\n_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_" || true; gh issue close "$p" --reason completed || true; fi; done`), and return to step 8.
    10a. **Stale-claim reclamation:** If candidate is a stale claim per `ORCHESTRATION.md`, re-read immediately before writing, unassign the dead owner, post reclamation comment, and proceed to claim.
11. **Claim protocol:**
    a. Re-read candidate issue immediately before claiming (`issue_read`). If assigned to a user other than yourself or the configured bot persona (`vars.AGENT_BOT_LOGIN`), abort and pick next candidate.
    b. Claim atomically: assign yourself (`login` from step 7) AND post claim comment:
    - In **Cloud Actions**: `🔒 Claimed by autowork run {run_url} {timestamp}`
    - In **Local Agent**: `🔒 Claimed by local autowork session (host: {hostname}) {timestamp}`
    c. Confirm sole ownership by counting `🔒 Claimed by autowork run` / `🔒 Claimed by local autowork session` comments. Earliest `created_at` wins. If you lost the race, leave assignee as is, annotate your comment, and pick next candidate.
    d. **Dynamic Target Binding (Scan Mode)**: If `$ROUTINE_ISSUE_NUMBER` is set and its title does not mention `Issue #<TARGET_ISSUE>`, update the routine issue title to bind the target issue:
       ```bash
       TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
       gh issue edit "$ROUTINE_ISSUE_NUMBER" --title "[autowork] run ${TIMESTAMP} (Issue #<TARGET_ISSUE>)" || true
       ```
12. Evaluate whether the claimed issue can be completed autonomously:
    - Confirm your `🔒` claim comment is present on the issue.
    - Read the issue description, linked code, and comment thread.
    - **Prior Failure Ingestion Protocol**: Query open routine run issues for `<TARGET_ISSUE>`:
      ```bash
      gh issue list --label routine-log --search "Issue #<TARGET_ISSUE>" --state open --json number,title,body
      ```
      If prior failed routine issues are found (carrying label `status:failure` or an Interruption Card):
      - Read the Interruption Card or latest milestone card to identify previous failure causes (e.g. failing test suite, build failure, timeout, or infeasible dependency).
      - Incorporate findings into the reproduction plan and note in Milestone 1:
        `- **Prior Failure Context**: <summary of past error/crash and strategy to avoid repeating it>`
    - If bug: use `/diagnosing-bugs` to establish reproduction test before fixing.
    - If large/complex: use `/domain-modeling` and `/codebase-design`.
    - **Pre-Flight Memory Scan**: If `LESSONS.md` exists, grep matching subsystem tags (`grep -E "^### \[(subsystem)\]" LESSONS.md -A 4`) to incorporate known landmines into implementation plans before writing code.
    - **The Red Gate Protocol (Pre-Implementation Verifier Check)**: Before writing ANY production implementation code, define the verifier or write a reproduction test, and execute it:
      - **The check MUST fail** (red). If the verifier passes before you touch production code, the subsequent work proves nothing.
      - **Already Green Check**: If the verifier passes *before* code changes, stop immediately and evaluate:
        1. *Already Resolved*: If the requested behavior or fix is already present in `origin/main` (e.g. shipped under another card or refactor), verify thoroughly, close the issue immediately (`gh issue close <ISSUE_NUMBER> --comment "Closed: verified already resolved on main."`), release the claim, and proceed to the next candidate. Running the Red Gate first catches stale work in seconds and saves hours of redundant coding.
        2. *Vacuous Assertion (Bogus Green)*: If the feature is missing but the test passes, the test is vacuous (silent no-match, erring swallowed command, or trivial assertion). Refactor the test until it reliably fails against the baseline before implementing.
    - **Ambiguity & Missing Acceptance Criteria Gate**: Challenge underspecified or incomplete requests before writing any code. If the issue lacks observable acceptance criteria, relies on unverified assumptions, or leaves critical technical/UX decisions ambiguous:
      - Do NOT guess or invent arbitrary requirements to force completion.
      - Post the mandatory 4-part escalation card on the issue:
        ```markdown
        ## 🛑 Escalation: Human Decision Required
        - **Decision Needed**: [1 focused question or choice]
        - **Evidence ("Why I believe this")**: [Specific files, lines, test outputs, or conflicting docs]
        - **Evaluated Options & Trade-offs**:
          - *Option A*: [Pros / Cons]
          - *Option B*: [Pros / Cons]
        - **Recommended Path**: [Agent recommendation]
        ```
      - Apply the `needs-info` label and release the claim (unassign).
      - Select the next candidate (evaluating ambiguous issues counts toward step 12's infeasible-continuation cap).
    - **Intent vs. Defect Guardrail**: When investigating issues related to low conversion, zero-click events, or underperforming features: verify whether the issue is a software defect or a lack of user intent. If data indicates the root cause is **lack of user intent** (e.g. button is rendered above fold and functions correctly when clicked, but user interaction rate is <2%) rather than a software defect, do NOT fall into the **telemetry rabbit hole** (adding elaborate fallback telemetry, downstream error handling, or defensive rendering). Categorize the issue as a **product/UX question** (`needs-design` / `roadmap/*`), comment explaining the lack of user intent, release the claim (unassign), and select the next candidate.
    - **Telemetry Design & Measurement Contract Gate**: When implementing new features or interactive surfaces, classify them according to the 3-Tier Telemetry Taxonomy in `AGENTS.md`:
      - **Tier 1 (Core Funnel & Levers)**: You MUST implement the complete measurement contract: impression denominator (`_shown`), interaction CTA (`_clicked`), completion (`_completed`), and structured failure/abandonment branches (`_failed` with `reason`). Update the repository's custom events catalog (`ARCHITECTURE.md` / `DATA_CONTEXT.md`).
      - **Tier 2 (Exploratory UX)**: Instrument only if the issue specification explicitly defines a hypothesis, metric question, or companion `Measure: ...` issue.
      - **Tier 3 (Passive Chrome & Utility / Easter Eggs)**: Do NOT add custom events or click trackers for cosmetic easter eggs, footer attribution popovers, theme toggles, or standard modal dismissals. Keep the codebase free from vanity tracking noise.
    - If infeasible: comment explaining blocker, release claim (unassign), and select next candidate (up to 3 infeasible evaluations per run). If permanent blocker on 2nd strike, post the mandatory 4-part escalation card (`## 🛑 Escalation: Human Decision Required`), apply `needs-human` label, and tag repo owner.
      12a. **Umbrella-issue handoff + batching:** If candidate is an umbrella epic:
    - Read `🧭 Decomposition plan` comment (or create if first run).
    - Pick next slice(s), batching up to 3 same-recipe slices into one child issue + PR.
    - Create and claim child issue first, then update plan marker to `🚧 in progress — child #M`, release umbrella claim, and implement against child.
    - **Milestone 1 (Intake & Strategy)**: If `$ROUTINE_ISSUE_NUMBER` is set, emit milestone card to the routine issue thread:
      ```bash
      gh issue comment "$ROUTINE_ISSUE_NUMBER" --body "### 🧭 Milestone: Intake & Strategy
- **Phase**: \`Phase 1 · Target Selection & Planning\`
- **Status**: ⏳ In Progress
- **Target / Context**: \`#<TARGET_ISSUE> (<Title>)\`
- **Prior Failure Context**: <summary of past error/crash and strategy to avoid repeating it>
- **Key Decision / Finding**: <Summary of plan, root cause, or reproduction strategy>
- **Next**: Implementation & Test Verification" || true
      ```
13. **Implementation & PR creation:**
    - Branch from freshly fetched `origin/main` with descriptive name (e.g. `feat/...` or `fix/...`).
    - Drive implementation via `/tdd` (red-green-refactor): execute the Red Gate test first, write minimal code to pass, and refactor cleanly.
    - **Precision Git Scoping**: Never use bare `git commit` or `git add .` blindly. Stage and commit only designated paths explicitly: `git commit -m "<type>(<scope>): <subject>" -- <paths>`, or verify `git status --porcelain` before committing to avoid sweeping in scratch files or parallel artifacts.
    - **Diagnostic Reflex**: On unexpected test/build failure during TDD, grep symptom text in `LESSONS.md` before making speculative code edits.
    - Run repository tests and verification.
    - **Disk Read-Back Verification**: Verify written configs, schemas, and generated files by reading values directly back from disk files (`cat`, `jq`, test assertions), never from shell variables or memory.
    - **Pre-PR Lessons Capture Gate**: If solving the issue required overcoming a non-obvious quirk not caught by tests/linters, append a 3-line structured entry on the active PR branch adhering to the 25-entry hard cap. Never write to `LESSONS.md` directly on `main`.
    - **Milestone 2 (Verification & Tests)**: Once implementation passes tests and type checks, emit milestone card if `$ROUTINE_ISSUE_NUMBER` is set:
      ```bash
      gh issue comment "$ROUTINE_ISSUE_NUMBER" --body "### 🧪 Milestone: Verification & Tests
- **Phase**: \`Phase 2 · Implementation & Verification\`
- **Status**: ✅ Tests Passing
- **Target / Context**: \`#<TARGET_ISSUE>\`
- **Key Decision / Finding**: Tests verified passing with zero failures and clean type-check.
- **Next**: PR Creation & Autonomous Handoff" || true
      ```
    - Check for competing open PRs immediately before creating PR. If collision, bail cleanly.
    - Open draft PR via `gh pr create --draft --head <branch> --base main --title "<title>" --body "<body referencing Closes #N>"`.
    - **PR Priority Label Mirroring**: If the issue carried a priority label (`priority/P0`, `priority/P1`, `priority/P2`, `priority/P3`), add the identical priority label to the PR (`gh pr edit <PR> --add-label "<label>"` or via `--label` in create) so downstream review workflows can filter triggers immediately.
    - Verify PR URL returned. Update issue `## Tasks` checkboxes.
    - **Issue Cross-Reference Comment Guardrail**: Post an explicit comment on the tracking issue referencing the newly created PR (`gh issue comment <ISSUE_NUMBER> --body "Work in progress in PR #<PR_NUMBER>."`). This guarantees an unambiguous, permanent link on the issue timeline even when GitHub's native UI link is suppressed for bot draft PRs.
    - **Warm Context Assignment**: Assign yourself to the newly opened PR (`gh pr edit <PR> --add-assignee <login>`) to hold the reservation across Step 15's in-session review wait so parallel Scan routines recognise the PR as actively held by a live session.
    - Mark PR ready (`gh pr ready <PR>`).
    - **Auto-Closure on Success**: Once the PR is marked ready (`gh pr ready <PR>`), resolve and close any open past failed routine issues for `#<TARGET_ISSUE>`:
      ```bash
      PAST_FAILURES=$(gh issue list --label routine-log --search "Issue #<TARGET_ISSUE>" --state open --json number --jq '.[].number' || true)
      for past_num in $PAST_FAILURES; do
        if [ -n "$past_num" ] && [ "$past_num" != "$ROUTINE_ISSUE_NUMBER" ]; then
          gh issue comment "$past_num" --body "Resolved by autowork run ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-} (PR #<PR_NUMBER> created and ready).

_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_" || true
          gh issue close "$past_num" --reason completed || true
        fi
      done
      ```
    - **Milestone 3 (Autonomous Handoff)**: Once PR is marked ready, emit milestone card if `$ROUTINE_ISSUE_NUMBER` is set:
      ```bash
      gh issue comment "$ROUTINE_ISSUE_NUMBER" --body "### 🚀 Milestone: Autonomous Handoff
- **Phase**: \`Phase 3 · Autonomous Handoff\`
- **Status**: ✅ PR Marked Ready
- **Target / Context**: \`PR #<PR_NUMBER> (closes #<TARGET_ISSUE>)\`
- **Key Decision / Finding**: Pushed branch and marked PR ready for review.
- **Next**: In-session review wait or run completion" || true
      ```
14. If run aborts before opening PR, release claim (unassign).
15. **In-Session Peer Review Wait & Immediate Convergence (Warm Context):**
    - Poll PR status for up to 10–12 minutes.
    - If merged: unassign yourself, resolve and close any open past failed routine run issues for `#<TARGET_ISSUE>`, record terminal SUCCESS and exit cleanly:
      ```bash
      PAST_FAILURES=$(gh issue list --label routine-log --search "Issue #<TARGET_ISSUE>" --state open --json number --jq '.[].number' || true)
      for past_num in $PAST_FAILURES; do
        if [ -n "$past_num" ] && [ "$past_num" != "$ROUTINE_ISSUE_NUMBER" ]; then
          gh issue comment "$past_num" --body "Resolved by autowork run ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-} (PR #<PR_NUMBER> merged).

_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})_" || true
          gh issue close "$past_num" --reason completed || true
        fi
      done
      ```
    - If bounced to draft with findings: fetch review comments, apply fixes in active worktree, run tests, push fix commit, re-mark ready (`gh pr ready <PR>`), and complete run.
    - If timeout (>12m): unassign yourself from the PR (`gh pr edit <PR> --remove-assignee <login>`) and exit cleanly; scheduled cron will handle subsequent rounds.

## Logging

After completing (SUCCESS or FAILURE), record run execution details to `.jonah-fleet/run-report.md`. Include:

- The prompt SHA (run `git rev-parse --short HEAD:.github/prompts/autowork.md`)
- Every Definition of Done criterion with YES/NO and evidence
- Full execution trace with tool calls
- If FAILURE: root cause, category, and suggested fix

**Issue Logging Protocol & Invariants**:

- **Negative Rule**: NEVER commit or push run logs to any git branch (`main` or feature branches). Run logs are recorded exclusively as GitHub Issues and local `.jonah-fleet/runs/*.json` artifacts.
- **Milestone 4 (Run Completed)**: If `$ROUTINE_ISSUE_NUMBER` is set in the environment, append the concluding compact milestone card to close out the comment stream:
  ```bash
  gh issue comment "$ROUTINE_ISSUE_NUMBER" --body "### 🏁 Milestone: Run Completed
- **Phase**: \`Phase 4 · Reconciliation\`
- **Status**: ✅ SUCCESS
- **Target / Context**: \`#<TARGET_ISSUE>\` · \`PR #<PR_NUMBER>\`
- **Key Decision / Finding**: All DoD criteria satisfied and verified.
- **Next**: Routine finished; issue closed by harness" || true
  ```
- **Harness Reconciliation**: When running under GitHub Actions or `jonah-fleet daemon`, the harness initializes the run issue (`status:running`), replaces the top-level issue body with `.jonah-fleet/run-report.md`, and reconciles the final status upon completion:
  - On **SUCCESS**: Labels `status:success`, removes `status:running`, and closes the issue.
  - On **FAILURE**: If interrupted or failed, the harness posts the Interruption Card, edits the body, and marks `status:failure,needs-attention`.
  - On clean local runs outside a harness, write `.jonah-fleet/runs/{timestamp}.json`.
- Follow the Routine Issue Logging & Telemetry Protocol in `ORCHESTRATION.md`.

<!--
================================================================================
TIER 2: SEMI-STABLE PROJECT RULES
Repository rules from AGENTS.md, manifest configurations, and LESSONS.md.
Cacheable across consecutive runs within the same repository.
================================================================================
-->

## Repository Rules & Project Context (Tier 2)

In this tier, Autowork ingests semi-stable repository conventions, operational memory, and configuration rules that change infrequently across consecutive runs in the same repository:

1. **Repository Conventions (`AGENTS.md`)**: Read `AGENTS.md` (or `CLAUDE.md` / `GEMINI.md`) for build/test/lint commands, code formatting rules, architectural guidelines, and design system tokens.
2. **Operational Memory (`LESSONS.md`)**: If `LESSONS.md` exists, ingest active operational gotchas (`grep -E "^### \[(subsystem)\]" LESSONS.md -A 4`) to avoid known pitfalls and regression patterns (enforcing the 25-entry hard cap).
3. **Fleet Manifest (`agents-manifest.json`)**: Ingest configured presets, model family assignments, and timeout/iteration ceilings.
4. **Engineering Skills (`.agents/skills/`)**: Leverage domain skills (`code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-me`, `resolving-merge-conflicts`, `tdd`, `triage`, `writing-for-agents`).

<!--
================================================================================
TIER 3: DYNAMIC TAIL PAYLOAD
Target issue / PR data, git diff, active branch, timestamps, and runtime vars.
Appended strictly at the tail of the prompt to preserve prefix cache validity.
================================================================================
-->

## Dynamic Context & Execution Payload (Tier 3)

The dynamic execution context for this specific run is injected strictly at the tail of the prompt:

- **Target Issue**: In Targeted mode, `$TARGET_ISSUE` (or `$ISSUE_NUMBER`), issue title, description, and task checklist. In Scan mode, dynamic priority selection applies.
- **Runtime Metadata**: `$ROUTINE_ISSUE_NUMBER`, `$GITHUB_RUN_ID`, runner timestamp, and trigger event name.
- **Active Workspace Context**: Branch name (`feat/...` or `fix/...`), git merge-base diff against `origin/main`, and test output.
- **Prefix Caching Invariant**: Harnesses and runners MUST NEVER interpolate dynamic timestamps, run IDs, or target identifiers into Tier 1 or Tier 2 prefix blocks.

