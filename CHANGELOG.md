# Changelog

All notable changes to `jonah-fleet` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.14.0](https://github.com/juliendurandeu/jonah-fleet/compare/v1.13.0...v1.14.0) (2026-09-19)


### Features

* **prompts:** restructure routine templates for 3-tier prompt prefix caching ([#210](https://github.com/juliendurandeu/jonah-fleet/issues/210))
* **workflows:** handle LLM quota limits with graceful pause (status:quota-paused) ([#240](https://github.com/juliendurandeu/jonah-fleet/issues/240)) ([98bb176](https://github.com/juliendurandeu/jonah-fleet/commit/98bb176f0b29462ab9de6baf5d0f102fee78b0ba))

## [1.13.0](https://github.com/juliendurandeu/jonah-fleet/compare/v1.12.0...v1.13.0) (2026-09-19)


### Features

* **guard:** implement CLI runner loop-guard and circuit-breaker wrapper ([#222](https://github.com/juliendurandeu/jonah-fleet/issues/222)) ([bedacc0](https://github.com/juliendurandeu/jonah-fleet/commit/bedacc0d9bc2a36276f58901ffa2f2b06e797016))
* **memory:** introduce opt-in LESSONS.md operational memory tier ([#207](https://github.com/juliendurandeu/jonah-fleet/issues/207)) ([#219](https://github.com/juliendurandeu/jonah-fleet/issues/219)) ([13f74fa](https://github.com/juliendurandeu/jonah-fleet/commit/13f74fa2acc78554bba486b2bf77521106265f03))
* **orchestration:** standardize 'Why I believe this' structured human escalation card ([#229](https://github.com/juliendurandeu/jonah-fleet/issues/229)) ([997e1d2](https://github.com/juliendurandeu/jonah-fleet/commit/997e1d20d7d0a3970ecca9f209841db745f99979))

## [1.12.0](https://github.com/juliendurandeu/jonah-fleet/compare/v1.11.0...v1.12.0) (2026-09-18)


### Features

* **radar:** add zqiren/Orbital to ecosystem radar and evaluation matrix ([#212](https://github.com/juliendurandeu/jonah-fleet/issues/212)) ([910febb](https://github.com/juliendurandeu/jonah-fleet/commit/910febbbc8196d53c20f05730770aae231a6b8ea)), closes [#206](https://github.com/juliendurandeu/jonah-fleet/issues/206)


### Bug Fixes

* **runner:** prevent premature routine termination on async background tasks in headless mode ([6641b2b](https://github.com/juliendurandeu/jonah-fleet/commit/6641b2b2e46ab363b73d490aac1144a33a1c69f9))

## [1.11.0](https://github.com/juliendurandeu/jonah-fleet/compare/v1.10.0...v1.11.0) (2026-09-17)


### Features

* **daemon:** auto-reconcile orphaned local routine runs on startup ([#188](https://github.com/juliendurandeu/jonah-fleet/issues/188)) ([dcc7746](https://github.com/juliendurandeu/jonah-fleet/commit/dcc7746268cd1921dbfb8e23c57ac46cf9217b83))

## [1.10.0](https://github.com/juliendurandeu/jonah-fleet/compare/v1.9.2...v1.10.0) (2026-09-17)


### Features

* **radar:** expand Category A heuristics to include prompt engineering optimizations and release tag_name ([#186](https://github.com/juliendurandeu/jonah-fleet/issues/186)) ([37fb3fc](https://github.com/juliendurandeu/jonah-fleet/commit/37fb3fca85b2f880de90df6a4baf9ec50f624003))
* **radar:** surface actionable opportunities with deterministic A/B/C classification ([#181](https://github.com/juliendurandeu/jonah-fleet/issues/181)) ([b9809c0](https://github.com/juliendurandeu/jonah-fleet/commit/b9809c0c1b54cb690c878d574cecbe1a4ce33480))


### Bug Fixes

* **runner:** capture stderr and handle signal exit codes in fallback error diagnostics ([#176](https://github.com/juliendurandeu/jonah-fleet/issues/176)) ([9bbe8eb](https://github.com/juliendurandeu/jonah-fleet/commit/9bbe8eb7cd52deab74c0bc9d503011511502a98f))

## [1.9.2](https://github.com/juliendurandeu/jonah-fleet/compare/v1.9.1...v1.9.2) (2026-09-16)


### Bug Fixes

* **workflows:** resolve indentation syntax error in interruption card and add yaml validator test ([b312a20](https://github.com/juliendurandeu/jonah-fleet/commit/b312a2056da850876ee3daa2d952ffe299687b7e))

## [1.9.1](https://github.com/juliendurandeu/jonah-fleet/compare/v1.9.0...v1.9.1) (2026-09-16)


### Bug Fixes

* **ci:** supply GH_REPO to gh cli in release-please workflow ([a5a3669](https://github.com/juliendurandeu/jonah-fleet/commit/a5a3669fe3849de013e6d915af874b88f23b1867))

## [1.9.0](https://github.com/juliendurandeu/jonah-fleet/compare/v1.8.0...v1.9.0) (2026-09-16)


### Features

* **ci:** automate release pipeline with auto-merge and tag alignment ([#105](https://github.com/juliendurandeu/jonah-fleet/issues/105)) ([2e4d34b](https://github.com/juliendurandeu/jonah-fleet/commit/2e4d34bb35a4768372232112c455bb5df6849119))
* **labels:** support auto-provisioning of fleet labels via CLI and sync ([1729473](https://github.com/juliendurandeu/jonah-fleet/commit/1729473ed9964740e4cba591cd773224c36be298))
* **logging:** migrate routine run logs to GitHub Issues ([#137](https://github.com/juliendurandeu/jonah-fleet/issues/137)) ([13bff52](https://github.com/juliendurandeu/jonah-fleet/commit/13bff5251da1cbaefc57b942d894413abed6a1a1))
* **models:** upgrade default LLM models to Gemini 3.8 Flash ([ef436fc](https://github.com/juliendurandeu/jonah-fleet/commit/ef436fc6d893cff487d9a5ae1017cb5081f3bafb))
* **peer-review:** link routine run log issue from starting review markers and PR comments ([9bac85a](https://github.com/juliendurandeu/jonah-fleet/commit/9bac85afcf9c23ea5aa46eaf9a0c4de2a37eaf20))
* **routines:** introduce autonomous Design Review routine ([#110](https://github.com/juliendurandeu/jonah-fleet/issues/110)) ([1e4f05b](https://github.com/juliendurandeu/jonah-fleet/commit/1e4f05ba55bdedadebcce8639102257930ebaf83))
* **runner:** display truncated PR and issue titles in daemon spinner ([#107](https://github.com/juliendurandeu/jonah-fleet/issues/107)) ([9b2ca79](https://github.com/juliendurandeu/jonah-fleet/commit/9b2ca796ab37872ff056dad486c9faea80d6c1a0))
* **telemetry:** live progress reporting and compact milestone cards in routine run issues ([#168](https://github.com/juliendurandeu/jonah-fleet/issues/168)) ([0899cdc](https://github.com/juliendurandeu/jonah-fleet/commit/0899cdcbdce7b7411bd85beedd1ffe8b05465cb5))


### Bug Fixes

* **daemon:** scope routine prompts strictly to target repository working directory ([62affb8](https://github.com/juliendurandeu/jonah-fleet/commit/62affb8b6dade15f7296e09d28a52359d1d05bb1))
* **prompts:** enforce active origin sync in autowork and conflict resolution in peer-review ([2bb1832](https://github.com/juliendurandeu/jonah-fleet/commit/2bb1832154312f78503da1e7035dc91e4247c9a8))
* **runner,daemon:** prevent stale report ghosting and fix keyboard lockup in targeted prompts ([#166](https://github.com/juliendurandeu/jonah-fleet/issues/166)) ([0de89e2](https://github.com/juliendurandeu/jonah-fleet/commit/0de89e24427f9e575f08cd721434ab5156fdcb94))
* **workflows:** harden workflow templates against shell injection, credential persistence, and timeouts ([04a0dd3](https://github.com/juliendurandeu/jonah-fleet/commit/04a0dd3a0457fd4d6db74fcd4709fcef0d28d84e))

## [Unreleased] - 2026-09-17

### Features

* **daemon:** auto-reconcile orphaned local routine run issues on daemon startup after host reboots or process crashes.
* **radar:** expand Category A heuristics in `fetch-symphony-radar.js` to detect prompt engineering optimizations and release `tag_name` fallbacks, prioritize Category A invariants over runtime keywords, and refine empty lookback checklist phrasing ([#184](https://github.com/juliendurandeu/jonah-fleet/issues/184)).
* **radar:** deterministically classify upstream changes across Symphony and Funes into Category A/B/C and surface architectural opportunities with callout summaries, breakdown matrices, and dynamic triage checklists ([#152](https://github.com/juliendurandeu/jonah-fleet/issues/152)).
* **telemetry:** introduce live progress reporting in routine run tracking issues (`routine-log`) using bounded Compact Milestone Cards (3–5 bullet points for Intake & Strategy, Verification & Tests, Autonomous Handoff, and Run Completed) across `autowork`, `peer-review`, `optimizer`, and `ORCHESTRATION.md`.
* **workflows:** automatically post Interruption Cards to routine run issue comment streams upon failure, timeout, or cancellation, linking directly to the Actions run logs before applying `status:failure,needs-attention`.
* **runner:** add `formatMilestoneCard`, `formatInterruptionCard`, and `tryPostLocalRunMilestone` helpers to local runner `runner.ts` to post interruption cards on non-zero exit codes with offline fallback.
* **logging:** migrate routine run telemetry and execution logs from git repository files (`.github/prompts/logs/**`) to GitHub Issues with two-phase lifecycle (`routine-log`, `status:running` -> `status:success` closed / `status:failure,needs-attention` open).
* **runner:** support local runner and daemon issue lifecycle with `runner:local` and offline fallback to `.jonah-fleet/runs/*.md`.
* **telemetry:** update fleet telemetry hub, status command, and optimizer routine to query routine run issues via `gh issue list --label routine-log` and local `.jonah-fleet/runs/`.
* **housekeeping:** replace log-only PR sweep with stalled routine run issue audit (`status:running` > 6 hours).
* **routines:** introduce autonomous Design Review routine for design system purity, UI clutter audit, and feature pruning.
* **runner:** display clean, truncated PR and Issue titles in foreground daemon spinner alongside target numbers.
* **peer-review:** link routine tracking log issue directly from "Starting review (round N)" PR comments and review summaries.
* **models:** upgrade default LLM models to Gemini 3.8 Flash (`gemini-3.8-flash-high` for core reasoning routines, `gemini-3.8-flash-medium` for housekeeping, dependency check, and analytics) to ensure CLI compatibility and access to the latest model capabilities.

### Bug Fixes

* **daemon:** prevent keyboard lockup and prompt corruption during targeted input by resuming stdin stream, restoring raw mode, and suppressing status ticker during prompt interactions.
* **runner:** prevent stale report ghosting on routine failure or timeout by cleaning up preexisting run reports before execution, validating report modification timestamps against run start, and appending trailing error output to fallback failure summaries.
* **daemon:** prevent keyboard lockup by explicitly resuming `stdin` after targeted interactive prompts (`R` and `A`) and ensure `KeyboardController.resume()` unpauses the underlying stream.
* **daemon:** suppress status-line ticker updates and interval check dispatches while waiting for targeted user input to avoid prompt visual corruption and background task collisions.

## [1.8.0](https://github.com/juliendurandeu/jonah-fleet/compare/jonah-fleet-v1.7.0...jonah-fleet-v1.8.0) (2026-09-09)


### Features

* **labels:** prune unused labels via CLI and housekeeping routine ([#99](https://github.com/juliendurandeu/jonah-fleet/issues/99)) ([b4a3ba2](https://github.com/juliendurandeu/jonah-fleet/commit/b4a3ba2f70bd2b899a02d33f6b3331eb6ec990c2)), closes [#97](https://github.com/juliendurandeu/jonah-fleet/issues/97)


### Bug Fixes

* **prompts:** prevent stray issues via tracking and closure guardrails ([#102](https://github.com/juliendurandeu/jonah-fleet/issues/102)) ([6e9b1ec](https://github.com/juliendurandeu/jonah-fleet/commit/6e9b1ec12e85b5fc98f6decf43cd4f5888d790d6))
* **workflows:** move concurrency to job level to avoid self-cancelling on skipped triggers ([#100](https://github.com/juliendurandeu/jonah-fleet/issues/100)) ([#101](https://github.com/juliendurandeu/jonah-fleet/issues/101)) ([3710bac](https://github.com/juliendurandeu/jonah-fleet/commit/3710bacedffeffcd90434756f3bae1c1dd323017))

## [1.7.0](https://github.com/juliendurandeu/jonah-fleet/compare/jonah-fleet-v1.6.0...jonah-fleet-v1.7.0) (2026-09-09)


### Features

* **daemon:** interactive keyboard controller with idle hotkeys and execution queue ([#91](https://github.com/juliendurandeu/jonah-fleet/issues/91)) ([3536e9a](https://github.com/juliendurandeu/jonah-fleet/commit/3536e9ab38849550ad7c6d846e6a2488b187f490))
* **daemon:** rotating status-line tips and narrow-width terminal guardrails ([#90](https://github.com/juliendurandeu/jonah-fleet/issues/90)) ([#93](https://github.com/juliendurandeu/jonah-fleet/issues/93)) ([2efdfbf](https://github.com/juliendurandeu/jonah-fleet/commit/2efdfbf45c18a746ed1ce4ed7338e2b73ab9f352))
* **daemon:** targeted execution prompts ('R' and 'A') and utility hotkeys ('v', 'l', 'w') ([#92](https://github.com/juliendurandeu/jonah-fleet/issues/92)) ([00c45f4](https://github.com/juliendurandeu/jonah-fleet/commit/00c45f4563049c86f1dbe956eb4e3f8b634c7918))
* **manifest:** support model and reasoning effort profiles in agents-manifest.json ([#3](https://github.com/juliendurandeu/jonah-fleet/issues/3)) ([#85](https://github.com/juliendurandeu/jonah-fleet/issues/85)) ([ff2f654](https://github.com/juliendurandeu/jonah-fleet/commit/ff2f654d73d7d49b21379264216e98434e2f1f91))
* **radar:** expand upstream radar to track funes alongside symphony for agent memory intelligence ([#84](https://github.com/juliendurandeu/jonah-fleet/issues/84)) ([4d8e127](https://github.com/juliendurandeu/jonah-fleet/commit/4d8e1273c48895d995d792789eb4a4baef968549))


### Bug Fixes

* **daemon:** avoid TDZ ReferenceError on graceful stop and signal handlers ([#94](https://github.com/juliendurandeu/jonah-fleet/issues/94)) ([7ca5fb7](https://github.com/juliendurandeu/jonah-fleet/commit/7ca5fb7a0849ee9babc8165253f9566c6c51963c))

## [1.6.0](https://github.com/juliendurandeu/jonah-fleet/compare/jonah-fleet-v1.5.0...jonah-fleet-v1.6.0) (2026-09-08)


### Features

* **autowork:** single-flight PR claim protocol in Phase 1 convergence ([#59](https://github.com/juliendurandeu/jonah-fleet/issues/59)) ([991e3f6](https://github.com/juliendurandeu/jonah-fleet/commit/991e3f6d3848bbb8dda7e6b8667533dc0ffef56d))
* **daemon:** display target PR/issue ID & title and wrap terminal card lines without cropping ([#60](https://github.com/juliendurandeu/jonah-fleet/issues/60)) ([43a3abb](https://github.com/juliendurandeu/jonah-fleet/commit/43a3abb51f86b5f0368ea2fdfc0f26e38f833ab9))
* **daemon:** drain reviewable PR backlog before moving to autowork ([#62](https://github.com/juliendurandeu/jonah-fleet/issues/62)) ([eeb9d57](https://github.com/juliendurandeu/jonah-fleet/commit/eeb9d57e5df4d00fa0b9f824ff231b7df9625386))
* **evals:** add fleet ambiguity telemetry, optimizer anomaly heuristics, and automated benchmark evals ([#68](https://github.com/juliendurandeu/jonah-fleet/issues/68)) ([a377ea5](https://github.com/juliendurandeu/jonah-fleet/commit/a377ea5ffd0ff21898a8f921f8738fa2b886448c))
* **prompts:** enforce log delivery protocol with [skip ci] and branch invariants ([#74](https://github.com/juliendurandeu/jonah-fleet/issues/74)) ([23b033f](https://github.com/juliendurandeu/jonah-fleet/commit/23b033fc06aaa2ed5cca292be16f6db70a194465))
* **prompts:** guard orphaned ready PR recovery against unstable and unapproved CI ([#75](https://github.com/juliendurandeu/jonah-fleet/issues/75)) ([8a0868b](https://github.com/juliendurandeu/jonah-fleet/commit/8a0868bde2ceab909b9bc01a30046818947a0f3a))
* **workflow:** authenticate checkout with GH_PAT token in autowork workflows ([#73](https://github.com/juliendurandeu/jonah-fleet/issues/73)) ([7a276a6](https://github.com/juliendurandeu/jonah-fleet/commit/7a276a60cc3dc3f1f31514efd657a0f714fa12cf))
* **workflow:** automate run log delivery to main with [skip ci] ([#72](https://github.com/juliendurandeu/jonah-fleet/issues/72)) ([0dc1b3b](https://github.com/juliendurandeu/jonah-fleet/commit/0dc1b3b8bbe626fbce0f5d73fa67e98df165339f))


### Bug Fixes

* **ci:** avoid direct secrets reference in release-please if conditional ([#83](https://github.com/juliendurandeu/jonah-fleet/issues/83)) ([6d6dcd9](https://github.com/juliendurandeu/jonah-fleet/commit/6d6dcd9c472f76dc6026ed16cca49cf665a6ea8c))

## [Unreleased] - 2026-09-09

### Fixed
- **workflows:** Move `concurrency` from workflow root to job level across event-triggered routine workflows (`trigger-review-routine.yml`, `trigger-autowork-on-bug.yml`, `trigger-autowork-on-merge.yml`) ([#100](https://github.com/juliendurandeu/jonah-fleet/issues/100)). In GitHub Actions, workflow-level concurrency is evaluated before job `if` filters, causing skipped events (such as startup comments posted by the review routine itself, comments without review commands, non-matching issue labels, or closed unmerged PRs) to prematurely cancel in-flight routine executions.
- **daemon:** Fix `ReferenceError: Cannot access 'tickerInterval' before initialization` on graceful stop (`q`) or SIGINT / SIGTERM during initial startup checks or routine executions by declaring interval and keyboard handles in outer scope before shutdown handlers.

### Added
- **labels:** Prune unused boilerplate labels via deterministic CLI and housekeeping routine ([#97](https://github.com/juliendurandeu/jonah-fleet/issues/97)):
  - Implemented `src/lib/labels.ts` with GraphQL label queries, pagination, and classification into `active`, `protected_zero_count`, `historical`, and `prunable`.
  - Added protected fleet taxonomy shields retaining `priority/*`, `type/*`, `size/*`, `needs-triage`, `ready-for-agent`, `needs-human`, `needs-info`, `needs-design`, `wontfix`, `measurement`, `blocked`, `autorelease:*`, `dependencies`, and `security` labels.
  - Added support for custom user-defined protected labels in `agents-manifest.json` (`labels.protected`) and `schema.json`.
  - Implemented `jonah-fleet labels audit` and `jonah-fleet labels prune [--dry-run] [--yes] [--repo <repo>] [--json]`.
  - Added `--prune-labels` flag to `jonah-fleet init` to optionally clean boilerplate labels on initial workspace setup.
  - Updated `issues-housekeeping.md` Step 6 to delegate label pruning to `npx --yes jonah-fleet labels prune --yes`.
  - Unit tests in `tests/labels.test.ts` and prompt validation tests in `tests/prompts-validation.test.ts`.
- **runner:** Stream real-time granular activity to foreground daemon spinner ([#96](https://github.com/juliendurandeu/jonah-fleet/issues/96)):
  - Updated agent invocation to run Antigravity CLI with `--output-format stream-json`.
  - Added line-buffered stream-json event parser in `src/lib/runner.ts` handling `step_update`, `tool`, `agent_response`, and `result` events.
  - Implemented `formatActionDescription` in `src/lib/terminal-card.ts` for readable tool verbs (`run_command`, `view_file`, `replace_file_content`, `grep_search`, `invoke_subagent`, etc.).
  - Added terminal column width bounds to `TerminalSpinner` to prevent line wrapping on long commands and window resizing.
  - Enhanced verbose mode with formatted, human-readable timestamped event streams.
  - Preserved raw stream-json in `.jonah-fleet/daemon.log` and ensured summary card extracts final response and tokens from `result` event.
- **daemon:** Rotating status-line tips and narrow-width terminal guardrails ([#90](https://github.com/juliendurandeu/jonah-fleet/issues/90)):
  - Added smooth 4-second cycling through all 11 keybinding tips in the foreground daemon's idle status line to promote frictionless hotkey discoverability.
  - Added paused status UX displaying `PAUSED` indicator and resume tips.
  - Added narrow terminal viewport width guardrails using ANSI-aware truncation (`truncateAnsi`), clamping ticker lines to `columns - 2` and omitting tips when columns < 55 to prevent line wrapping or scrolling artifacts.
  - Comprehensive unit test suites in `tests/daemon-keys.test.ts` and `tests/terminal-card.test.ts`.
- **daemon:** Targeted execution prompts and runtime utility hotkeys ([#89](https://github.com/juliendurandeu/jonah-fleet/issues/89)):
  - Added targeted execution hotkeys: `R` (prompts for PR # and runs targeted peer-review) and `A` (prompts for Issue # and runs targeted autowork).
  - Pauses raw mode safely during targeted prompt input, validates numeric identifiers (`42`, `#42`, `PR #42`, `Issue #89`), and provides clean cancellation on Esc/empty Enter.
  - Added runtime utility hotkeys: `v` (live verbosity mode toggling), `l` (print last 20 lines of `.jonah-fleet/daemon.log`), and `w` (inspect and clean stale worktrees on demand).
  - Updated keybindings cheat-sheet and daemon status summary with verbosity mode indicators.
  - Unit tests in `tests/daemon-keys.test.ts`.
- **daemon:** Interactive keyboard controller with idle hotkeys and execution queue ([#88](https://github.com/juliendurandeu/jonah-fleet/issues/88)):
  - Captures single-keypress inputs in foreground daemon mode without requiring Enter (`process.stdin.setRawMode`).
  - Added hotkeys: `r` (immediate peer-review scan), `a` (immediate autowork scan), `p` (pause/resume automatic polling), `s` (daemon status summary), `q` (graceful shutdown), `Ctrl+C` (force stop), and `?`/`h` (interactive cheat-sheet).
  - Single-slot pending execution queue (`pendingRoutine`) when pressing triggers while busy, dispatched immediately upon completion of active routine.
  - Paused state persistence in `daemon.json` (`status: 'paused'`), keeping manual sweeps functional.
  - Reset countdown timers upon on-demand sweep completion to prevent duplicate interval executions.
  - Unit tests in `tests/daemon-keys.test.ts`.

## [Unreleased] - 2026-09-08

### Added
- **manifest:** Support model profiles, reasoning effort levels, and budget controls in `agents-manifest.json` ([#85](https://github.com/juliendurandeu/jonah-fleet/pull/85)):
  - Extends `schema.json` with `models` and `budgets` configuration blocks.
  - Adds `resolveRoutineConfig()` helper in `src/lib/manifest.ts` with default fallback profiles in `src/lib/presets.ts`.
  - Updates all workflow templates and `.github/workflows/` with dynamic routine model and timeout resolution.
  - Enhances `jonah-fleet status` to render model profiles and configured budgets.
  - Adds unit test coverage in `tests/manifest.test.ts`.
- **radar:** Expand Upstream Radar to track `huggingface/funes` alongside `openai/symphony` ([#70](https://github.com/juliendurandeu/jonah-fleet/issues/70)):
  - Extended `.github/scripts/fetch-symphony-radar.js` into a multi-source ecosystem radar tracking Symphony (orchestration) and Funes (agent memory & session indexing).
  - Added dedicated Agent Memory & Session Indexing evaluation matrix covering zero-LLM ingestion, pull-based MCP memory delivery, cross-session provenance, and multi-agent portability.
  - Updated `symphony-radar.yml` workflow and `ORCHESTRATION.md` documentation.
  - Added unit test suite `tests/radar.test.ts` and updated workflow validation tests.

## [Unreleased] - 2026-09-07

### Changed
- **deps:** update `vitest` devDependency from `4.1.11` to `^5.0.0` ([#78](https://github.com/juliendurandeu/jonah-fleet/issues/78))

### Added
- **workflows:** Automate run log delivery directly to main with `[skip ci]` ([#72](https://github.com/juliendurandeu/jonah-fleet/pull/72)):
  - Adds deterministic post-step in `autowork-cron.yml` and `templates/workflows/autowork-cron.yml` to safely preserve and push operational execution logs directly to `main` with `[skip ci]`.
  - Adds workflow invariant tests in `tests/workflows-validation.test.ts`.
- **prompts:** Guard orphaned ready PR recovery against unstable and unapproved CI ([#75](https://github.com/juliendurandeu/jonah-fleet/pull/75)):
  - Adds Passing CI Verification Gate requiring `conclusion: "SUCCESS"` and `mergeStateStatus: "CLEAN"` in Step 3c of `autowork.md` and `ORCHESTRATION.md`.
  - Prohibits review re-triggering and draft toggles when checks are in-progress, failing, or in `ACTION_REQUIRED` awaiting permissions to prevent comment loops.
  - Adds validation test in `tests/prompts-validation.test.ts`.
- **workflows:** Authenticate checkout with `GH_PAT` token in autowork workflows ([#73](https://github.com/juliendurandeu/jonah-fleet/pull/73)):
  - Configures `actions/checkout@v4` with `token: ${{ secrets.GH_PAT || github.token }}` across all autowork workflow templates to attribute Git pushes to a write-permission token and avoid stalled approval checks.
  - Added workflow validation tests in `tests/workflows-validation.test.ts`.
- **telemetry:** Ambiguity Gate telemetry tracking and terminal dashboard integration:
  - Parses Ambiguity Gate triggers (`ambiguityGateTriggered`), count of clarifying questions asked (`questionsAskedCount`), and `needs-info` labels applied.
  - Aggregates fleet-wide inquisitive stance metrics and calculates estimated wasted tokens averted (~50k tokens per averted runaway run).
  - Terminal telemetry dashboard presents `❓ Inquisitive Stance & Ambiguity Gate Signals`.
- **optimizer & orchestration:** Passive Order-Taking Anomaly and Speculative Runaway Waste heuristics:
  - Documents the "Passive Order-Taking Anomaly (\"Yes-Man Blindspot\")" when agents default to compliance over inquiry, resulting in high iterations and PR review bounces.
  - Added "Ambiguity Gate & Benchmark Eval Feeding" remediation trigger in `optimizer.md` and `ORCHESTRATION.md`.
- **evals & benchmark:** Automated Ambiguity Benchmark engine and optimizer-fed test suite:
  - Created baseline dataset (`templates/evals/ambiguity-benchmark.json`) containing 10 calibrated issues (5 ambiguous requiring questions, 5 well-specified ready for implementation).
  - Implemented `evaluateIssueAmbiguity()`, `runAmbiguityBenchmark()`, `extractBenchmarkCaseFromLog()`, and `feedOptimizerCaseToBenchmark()` in `src/lib/evals.ts`.
  - Added unit tests in `tests/evals.test.ts` verifying 100% benchmark accuracy, 0% false compliance rate (yes-man error), question generation, and dynamic optimizer case feeding.

## [1.5.0](https://github.com/juliendurandeu/jonah-fleet/compare/jonah-fleet-v1.4.2...jonah-fleet-v1.5.0) (2026-09-03)


### Features

* **daemon:** extract reviewable PR filter helper and add unit tests for queue draining ([#66](https://github.com/juliendurandeu/jonah-fleet/issues/66))
* **daemon:** display target PR/issue ID & title and wrap terminal card lines without cropping
* **autowork:** single-flight PR claim protocol in Phase 1 convergence to prevent daemon race conditions on bounced PRs
* **autowork:** add selective server-side issue querying to prevent tool buffer truncation ([#54](https://github.com/juliendurandeu/jonah-fleet/issues/54)) ([e85958b](https://github.com/juliendurandeu/jonah-fleet/commit/e85958bc9129b16af170961a0ae85ff91211ec85))
* **daemon:** drain reviewable PR backlog via sequential peer review sessions before moving to autowork ([#61](https://github.com/juliendurandeu/jonah-fleet/issues/61)) ([#62](https://github.com/juliendurandeu/jonah-fleet/pull/62))
* **cli:** add multi-repo fleet monitoring command (jonah-fleet monitor) ([#6](https://github.com/juliendurandeu/jonah-fleet/issues/6)) ([0093c0f](https://github.com/juliendurandeu/jonah-fleet/commit/0093c0f2bdeb0d48d952119b96e541be73c59a03))
* **cli:** add per-agent token breakdown to jonah-fleet status and monitor commands ([#16](https://github.com/juliendurandeu/jonah-fleet/issues/16)) ([7e51d0c](https://github.com/juliendurandeu/jonah-fleet/commit/7e51d0cb6bdf8fef127cac7f13f8320821cb4391))
* **cli:** enhance jonah-fleet init with smart tech-stack auto-detection ([#37](https://github.com/juliendurandeu/jonah-fleet/issues/37)) ([b1b028a](https://github.com/juliendurandeu/jonah-fleet/commit/b1b028a5cc145aeb6a0a9b0df2e4ab010c1fa104))
* **daemon:** dynamically track and display active issue or PR in terminal spinner and status ([#57](https://github.com/juliendurandeu/jonah-fleet/issues/57)) ([f9c3baa](https://github.com/juliendurandeu/jonah-fleet/commit/f9c3baaab1562e21a0db170f311873cdc9a3e287))
* **daemon:** multi-cadence daemon, terminal cards, and strict allowlist review filters ([5889a0c](https://github.com/juliendurandeu/jonah-fleet/commit/5889a0c2b11b74faece74f7a64db43cb98fd47a1))
* **dual-execution:** priority-driven dual execution (local agents + actions) ([#53](https://github.com/juliendurandeu/jonah-fleet/issues/53)) ([5711bf3](https://github.com/juliendurandeu/jonah-fleet/commit/5711bf3798bba799ba4638c8cb2584878ad25d25))
* **evals:** add automated test suite for bi-directional optimization bridge and downstream sync ([#23](https://github.com/juliendurandeu/jonah-fleet/issues/23)) ([2e55227](https://github.com/juliendurandeu/jonah-fleet/commit/2e552273600c22879d81b6ad607ad912809d3dbb))
* **fleet-query:** extend fleet query engine with per-routine token and iteration aggregation ([#15](https://github.com/juliendurandeu/jonah-fleet/issues/15)) ([cabbbbc](https://github.com/juliendurandeu/jonah-fleet/commit/cabbbbcc62d8fe39ea135f56acdba0343aa11e02))
* **fleet:** initial release of jonah-fleet standalone agent suite and CLI ([1b08b3e](https://github.com/juliendurandeu/jonah-fleet/commit/1b08b3e14626cda25e76464d92782f16cfaae936))
* **optimizer:** implement token anomaly heuristics and automated PR triggers ([#10](https://github.com/juliendurandeu/jonah-fleet/issues/10)) ([#17](https://github.com/juliendurandeu/jonah-fleet/issues/17)) ([3090785](https://github.com/juliendurandeu/jonah-fleet/commit/30907857f7e24edaee1d2c2dbca61568d95f7767))
* **optimizer:** update optimizer routine with per-agent token aggregation protocol and scorecard schema ([#14](https://github.com/juliendurandeu/jonah-fleet/issues/14)) ([2e435ef](https://github.com/juliendurandeu/jonah-fleet/commit/2e435ef7492bf75dbf3c081d64375f49ea542667))
* **orchestration:** add failure notification and periodic scan watchdog to prevent stuck PRs ([#32](https://github.com/juliendurandeu/jonah-fleet/issues/32)) ([a7c555f](https://github.com/juliendurandeu/jonah-fleet/commit/a7c555f2f38a868674931bd9b61511b4530f2784))
* **orchestration:** add symphony radar, attribution notice, and inward blocker dependency gating ([#34](https://github.com/juliendurandeu/jonah-fleet/issues/34)) ([f8995ef](https://github.com/juliendurandeu/jonah-fleet/commit/f8995efd63a1509414768b2f0bf726d1de15a214))
* **peer-review:** add autonomous issue synthesis for unlinked PRs ([54e9a54](https://github.com/juliendurandeu/jonah-fleet/commit/54e9a54685ee89bf124923fb6086760c3753d097))
* **peer-review:** allow self-contained PR descriptions without blocking on linked issues ([97b7034](https://github.com/juliendurandeu/jonah-fleet/commit/97b703403040fc9dbe4f6b6622000822d9925aae))
* **prompts:** add Design System & Telemetry Friction Guardrails to core routines (closes [#49](https://github.com/juliendurandeu/jonah-fleet/issues/49)) ([#50](https://github.com/juliendurandeu/jonah-fleet/issues/50)) ([16d1011](https://github.com/juliendurandeu/jonah-fleet/commit/16d1011ac5255b84f93a8ece7e3f516d7355dc09))
* **prompts:** add feedback loop stagnation heuristic and closed-loop verification audit ([#24](https://github.com/juliendurandeu/jonah-fleet/issues/24)) ([c3ea012](https://github.com/juliendurandeu/jonah-fleet/commit/c3ea01297017347f6b3c43e4bdd99ea2704fd60e))
* **routines:** bridge analytics measurement outcomes into product planning for feature pivots and deprecations ([#43](https://github.com/juliendurandeu/jonah-fleet/issues/43)) ([446641d](https://github.com/juliendurandeu/jonah-fleet/commit/446641da7a9f9fc0c00dcf1fa98c26c067145ddc)), closes [#28](https://github.com/juliendurandeu/jonah-fleet/issues/28)
* **telemetry:** design and implement centralized cross-repo telemetry and token tracking hub (closes [#5](https://github.com/juliendurandeu/jonah-fleet/issues/5)) ([#22](https://github.com/juliendurandeu/jonah-fleet/issues/22)) ([e910277](https://github.com/juliendurandeu/jonah-fleet/commit/e9102779293601e94a23401a10e669bb174cb972))
* **workflows:** support custom cron schedules in manifest and preserve across syncs ([#47](https://github.com/juliendurandeu/jonah-fleet/issues/47)) ([#48](https://github.com/juliendurandeu/jonah-fleet/issues/48)) ([029fadb](https://github.com/juliendurandeu/jonah-fleet/commit/029fadbcabe805fb46268fa369e8f0f7272c33f1))
* **workflows:** support manual and comment-based (re)triggering for peer review routine ([#30](https://github.com/juliendurandeu/jonah-fleet/issues/30)) ([e8be955](https://github.com/juliendurandeu/jonah-fleet/commit/e8be955f429450fdce2d79f52a27c3ee4bb41acd)), closes [#29](https://github.com/juliendurandeu/jonah-fleet/issues/29)
* **workflows:** support triggering autowork via workflow_dispatch badge link (closes [#18](https://github.com/juliendurandeu/jonah-fleet/issues/18)) ([#20](https://github.com/juliendurandeu/jonah-fleet/issues/20)) ([a44e54e](https://github.com/juliendurandeu/jonah-fleet/commit/a44e54e647db11587ab58eb0ec01201cb7e9376f))


### Bug Fixes

* **ci:** grant issues:write to release-please and use googleapis action ([37a6782](https://github.com/juliendurandeu/jonah-fleet/commit/37a67824e4cbbced5e08dc48d79b70a4145646ff))
* **detector:** use literal replacers and pmPrefix for fastapi dev ([0b96e2a](https://github.com/juliendurandeu/jonah-fleet/commit/0b96e2a06230df86a1c5a9097aa98b380565bcc8))
* **security:** resolve Critical and High vulnerabilities in vitest and transitive dependencies ([#42](https://github.com/juliendurandeu/jonah-fleet/issues/42)) ([9c88fa9](https://github.com/juliendurandeu/jonah-fleet/commit/9c88fa97b1529ba20fc9223ddb6e7c08e1b345f6))


### Performance Improvements

* **workflows:** optimize github actions quota consumption ([#51](https://github.com/juliendurandeu/jonah-fleet/issues/51)) ([af8a8fb](https://github.com/juliendurandeu/jonah-fleet/commit/af8a8fb08cc9b884192e1204548a53b571f1a4a6))

## [1.4.2] - 2026-09-03

### Changed
- Strict Allowlist for Cloud Review Triggers:
  - Updated `trigger-review-routine.yml` to strictly require `priority/P0` or `priority/P1` labels to fire immediate cloud reviews on `pull_request` events.
  - Untagged PRs and lower-priority PRs (P2/P3) skip immediate cloud review, routing review execution exclusively to local peer-review daemons (with 48h scheduled cloud catchup fallback).
- Dynamic Issue & PR Target Tracking:
  - Added real-time target detection (`detectClaimedIssue` and `detectClaimedPR`) in `src/lib/terminal-card.ts` that dynamically switches the live spinner label from `autowork` / `peer-review` to `[Issue #<N>]` or `[PR #<N>]` the moment a candidate is claimed.
  - Added `activeTarget` tracking in `DaemonState` (`.jonah-fleet/daemon.json`), displayed in `jonah-fleet daemon status` (e.g. `WORKING on autowork (Issue #42)`).

## [1.4.1] - 2026-09-03

### Added
- Decoupled Multi-Cadence Daemon & Zero-Cost PR Preflight:
  - Added independent scheduling in `jonah-fleet daemon` via `--review-interval` (default: 3m) and `--autowork-interval` (default: 30m).
  - Added ultra-fast (~100ms) local PR preflight check (`countOpenReadyPRs`) in `src/lib/daemon.ts` that queries `gh pr list` and skips agent invocations with 0 token spend when 0 ready PRs are open.
- User-Friendly Terminal Cards & Daemon Ticker:
  - Replaced noisy raw markdown streaming in `jonah-fleet daemon --foreground` and `jonah-fleet run` with a dynamic single-line status spinner showing target and active phase heuristics.
  - Added real-time token stream redirection to `.jonah-fleet/daemon.log` with `-v, --verbose` escape hatch for debugging.
  - Added formatted Unicode summary and error cards with ephemeral worktree path sanitization and disk log fallbacks (`src/lib/terminal-card.ts`).
  - Added in-place countdown ticker (`\r`) during daemon watchdog idle states to avoid cluttering terminal scrollback.

## [1.4.0] - 2026-09-03

### Added
- Inquisitive Agent Fleet & Grilling Protocol:
  - Added new `grill-me` engineering skill (`templates/skills/grill-me/SKILL.md` and `.agents/skills/grill-me/SKILL.md`) to stress-test proposals, requirements, and designs through a targeted, sequential interview to eliminate assumptions before implementation (#54, #55).
  - Included `grill-me` in `standard` and `full` presets in `src/lib/presets.ts` and `agents-manifest.json` (#54, #55).
  - Added Requirements Discovery & Inquisitive Stance rules to `templates/docs/AGENTS.template.md` and `AGENTS.md`, establishing default skepticism on necessity, zero-guesswork ambiguity gates, and high-leverage question structuring (#54, #55).
  - Added Ambiguity & Missing Acceptance Criteria Gate to Step 12 in `autowork.md` (`templates/prompts/autowork.md` & `.github/prompts/autowork.md`) to post clarifying questions, label `needs-info`, and release the claim instead of making silent assumptions (#54, #55).
  - Added Selective Server-Side Issue Querying in Step 8 of `autowork.md` using `gh --search` with exclusion filters (`no:assignee -label:measurement -label:needs-human -label:needs-design -label:wontfix -label:needs-info`) to avoid tool buffer truncation and token waste (#54, #55).
  - Updated `triage.md` and `ORCHESTRATION.md` to integrate `/grill-me` into issue evaluation and planning (#54, #55).
- Priority-Driven Dual Agent Execution (Local + GitHub Actions):
  - Added CLI `jonah-fleet run <routine>` command to execute prompt routines locally with automatic Git worktree isolation (`.jonah-fleet/worktrees/`), protecting active working copies and uncommitted editor files.
  - Added CLI `jonah-fleet daemon [start|stop|status]` background worker to continuously poll open issues and PRs for local execution.
  - Added `dualExecution` configuration schema in `agents-manifest.json` and `schema.json` supporting configurable `cloudPriorities` (default: `['P0', 'P1']`) and `cloudCatchupHours` (default: `48`).
  - Added PR priority label mirroring in `autowork.md` to automatically mirror `priority/PX` labels onto opened PRs.
  - Added dual routing and 48-hour cloud catchup logic in `autowork.md`, `peer-review.md`, and `trigger-review-routine.yml`.
  - Added Git worktree isolation manager (`src/lib/worktree.ts`) and local routine runner (`src/lib/runner.ts`).
- Design System & Telemetry Friction Guardrails in Core Routines:
  - Added Design System & Viewport Density Pass to `peer-review.md` (`templates/prompts/peer-review.md` & `.github/prompts/peer-review.md`) enforcing Token Purity, WCAG AA 4.5:1 contrast ratios, single primary CTA hierarchy, and mobile viewport budget checks on UI diffs (#49).
  - Added Design System & Viewport Pre-flight to `autowork.md` (`templates/prompts/autowork.md` & `.github/prompts/autowork.md`) in Pre-ready self-audit (#49).
  - Added UI Friction & Nudge Fatigue Guardrail to `analytics-review.md` (`templates/prompts/analytics-review.md` & `.github/prompts/analytics-review.md`) to aggregate component-level `$rageclick` events and flag low-conversion promotional elements (500+ impressions, CTR < 2.0%) (#49).
  - Documented Design System & UI Guardrails in `templates/docs/AGENTS.template.md` and `AGENTS.md` (#49).
- Custom Cron Schedules & Sync Preservation: Added `schedules` configuration support in `agents-manifest.json` and `schema.json` for routines (`autowork`, `peer-review`, `optimizer`, `issues-housekeeping`, `dependency-update-security-check`, `analytics-review`, `sync-fleet`). Enhanced `installFleet()` and `checkDrift()` to dynamically inject configured schedules, preserve existing local workflow cron triggers, and prevent false-positive drift on synchronizations (#47).
- Analytics Review Routine (`templates/prompts/analytics-review.md` & `.github/prompts/analytics-review.md`): Evaluates active and scheduled measurement trackers against product metrics, user adoption, and conversion funnels. Requires mandatory structured action directives (`RECOMMENDATION: [PIVOT | DEPRECATE | ITERATE]`) upon measurement closure to bridge outcomes directly into product planning (#28).
- Feature Pruning & Deprecation Audit in Product Planning (`templates/prompts/product-planning.md` & `.github/prompts/product-planning.md`): Audits shipped features and closed measurement tracker verdicts in Propose mode for low-ROI / high-maintenance features (<2% adoption, >50% failure rate) and drafts deprecation / simplification proposals (#28).
- Intent vs. Defect Guardrail & Telemetry Rabbit Hole Prevention in Autowork and Diagnosing Bugs (`templates/prompts/autowork.md`, `.github/prompts/autowork.md`, `templates/skills/diagnosing-bugs/SKILL.md`, `.agents/skills/diagnosing-bugs/SKILL.md`): Prevents agents from wasting cycles writing elaborate fallback telemetry or defensive error handling when low adoption stems from lack of user intent rather than software defects, routing issues to `needs-design`/`roadmap/*` (#28).
- Post-Measurement Product Bridge & Intent vs. Defect Guardrail Architecture in `ORCHESTRATION.md` (#28).
- Registered `analytics-review` in `schema.json`, `src/lib/presets.ts`, `src/lib/manifest.ts`, and `full` preset bundle (#28).

### Performance
- GitHub Actions Quota Optimization:
  - Added zero-open-PR preflight check to `trigger-review-routine.yml` scheduled sweeps to skip Node setup, Antigravity CLI installation, and agent runs when no PRs are pending review, cutting empty sweep runner time from ~4m to ~3s (#51, #52).
  - Fixed `trigger-autowork-on-bug.yml` issue event trigger condition to strictly require both `bug` and priority labels (`priority/P1` or `priority/P0`), preventing arbitrary label modifications from spawning unnecessary runners (#51, #52).
  - Tightened job and step timeouts across routine trigger workflows (`trigger-review-routine.yml`, `trigger-autowork-on-bug.yml`, `trigger-autowork-on-merge.yml`) to 30m–35m to prevent runaway billing on stuck runners (#51, #52).

### Changed
- Upgraded development dependency `@types/node` from `22.20.1` to `^26.4.0` (#41).
- Upgraded development dependency `typescript` from `5.9.3` to `^7.0.2`, configured `"types": ["node"]` in `tsconfig.json`, and configured `tsc` declaration emit (#40).
- Upgraded production dependency `commander` from `12.1.0` to `^15.0.0` (#39).

### Fixed
- Resolved Critical (GHSA-5xrq-8626-4rwp), High (GHSA-fx2h-pf6j-xcff), and Moderate security vulnerabilities in `vitest` and transitive dependencies (`vite`, `esbuild`, `vite-node`, `@vitest/mocker`) by upgrading `vitest` to `^4.1.11` and overriding `esbuild` to `^0.28.2` (#38).

## [1.3.0](https://github.com/juliendurandeu/jonah-fleet/compare/jonah-fleet-v1.2.0...jonah-fleet-v1.3.0) (2026-08-31)


### Features

* **cli:** add multi-repo fleet monitoring command (jonah-fleet monitor) ([#6](https://github.com/juliendurandeu/jonah-fleet/issues/6)) ([0093c0f](https://github.com/juliendurandeu/jonah-fleet/commit/0093c0f2bdeb0d48d952119b96e541be73c59a03))
* **cli:** add per-agent token breakdown to jonah-fleet status and monitor commands ([#16](https://github.com/juliendurandeu/jonah-fleet/issues/16)) ([7e51d0c](https://github.com/juliendurandeu/jonah-fleet/commit/7e51d0cb6bdf8fef127cac7f13f8320821cb4391))
* **evals:** add automated test suite for bi-directional optimization bridge and downstream sync ([#23](https://github.com/juliendurandeu/jonah-fleet/issues/23)) ([2e55227](https://github.com/juliendurandeu/jonah-fleet/commit/2e552273600c22879d81b6ad607ad912809d3dbb))
* **fleet-query:** extend fleet query engine with per-routine token and iteration aggregation ([#15](https://github.com/juliendurandeu/jonah-fleet/issues/15)) ([cabbbbc](https://github.com/juliendurandeu/jonah-fleet/commit/cabbbbcc62d8fe39ea135f56acdba0343aa11e02))
* **fleet:** initial release of jonah-fleet standalone agent suite and CLI ([1b08b3e](https://github.com/juliendurandeu/jonah-fleet/commit/1b08b3e14626cda25e76464d92782f16cfaae936))
* **optimizer:** implement token anomaly heuristics and automated PR triggers ([#10](https://github.com/juliendurandeu/jonah-fleet/issues/10)) ([#17](https://github.com/juliendurandeu/jonah-fleet/issues/17)) ([3090785](https://github.com/juliendurandeu/jonah-fleet/commit/30907857f7e24edaee1d2c2dbca61568d95f7767))
* **optimizer:** update optimizer routine with per-agent token aggregation protocol and scorecard schema ([#14](https://github.com/juliendurandeu/jonah-fleet/issues/14)) ([2e435ef](https://github.com/juliendurandeu/jonah-fleet/commit/2e435ef7492bf75dbf3c081d64375f49ea542667))
* **peer-review:** add autonomous issue synthesis for unlinked PRs ([54e9a54](https://github.com/juliendurandeu/jonah-fleet/commit/54e9a54685ee89bf124923fb6086760c3753d097))
* **peer-review:** allow self-contained PR descriptions without blocking on linked issues ([97b7034](https://github.com/juliendurandeu/jonah-fleet/commit/97b703403040fc9dbe4f6b6622000822d9925aae))
* **prompts:** add feedback loop stagnation heuristic and closed-loop verification audit ([#24](https://github.com/juliendurandeu/jonah-fleet/issues/24)) ([c3ea012](https://github.com/juliendurandeu/jonah-fleet/commit/c3ea01297017347f6b3c43e4bdd99ea2704fd60e))
* **telemetry:** design and implement centralized cross-repo telemetry and token tracking hub (closes [#5](https://github.com/juliendurandeu/jonah-fleet/issues/5)) ([#22](https://github.com/juliendurandeu/jonah-fleet/issues/22)) ([e910277](https://github.com/juliendurandeu/jonah-fleet/commit/e9102779293601e94a23401a10e669bb174cb972))
* **workflows:** support manual and comment-based (re)triggering for peer review routine ([#30](https://github.com/juliendurandeu/jonah-fleet/issues/30)) ([e8be955](https://github.com/juliendurandeu/jonah-fleet/commit/e8be955f429450fdce2d79f52a27c3ee4bb41acd)), closes [#29](https://github.com/juliendurandeu/jonah-fleet/issues/29)
* **workflows:** support triggering autowork via workflow_dispatch badge link (closes [#18](https://github.com/juliendurandeu/jonah-fleet/issues/18)) ([#20](https://github.com/juliendurandeu/jonah-fleet/issues/20)) ([a44e54e](https://github.com/juliendurandeu/jonah-fleet/commit/a44e54e647db11587ab58eb0ec01201cb7e9376f))


### Added
- Smart Tech-Stack Auto-Detection for `jonah-fleet init` (`src/lib/detector.ts`): inspects repository files to detect languages (TypeScript, JavaScript, Python, Go, Rust), frameworks (Next.js, React, Remix, Astro, Vue, Nuxt, SvelteKit, Express, Fastify, NestJS, Koa, Hono, FastAPI, Django, Flask, Gin, Echo, Chi, Fiber, Axum, Actix Web, Rocket), package managers (npm, pnpm, yarn, bun, pip, uv, poetry, pipenv, go, cargo), linters, test runners, and auto-populates tailored build, test, and type-check commands into `AGENTS.md` (#4).
- CLI flag overrides (`--stack`, `--package-manager`, `--test-cmd`, `--build-cmd`, `--interactive`, `--no-interactive`) on `jonah-fleet init` for customized initialization.
- Inward Blocker Dependency Gating in `autowork.md` (`templates/prompts/autowork.md` and `.github/prompts/autowork.md`): automatically detects and gates issues carrying `Blocked by #N` / `Depends on #N` until prerequisite issues merge, preventing premature execution of dependent tasks.
- Standard `NOTICE` attribution file formally crediting OpenAI Symphony's architectural lineage under Apache-2.0.
- Automated Upstream Symphony Radar GitHub Actions workflow (`.github/workflows/symphony-radar.yml` and `.github/scripts/fetch-symphony-radar.js`) for periodic detection and issue reporting of specification updates in `openai/symphony`.
- Explicit Acknowledgments & Credits section in `README.md`.
- Review failure notification handler and 2-hour scheduled scan sweep watchdog in `trigger-review-routine.yml` to prevent stuck PRs and recover orphaned ready PRs.
- Orphaned ready PR watchdog in `autowork.md` (Step 3c) and Scan mode unreviewed prioritization in `peer-review.md`.
- Peer Review Resilience & Orphaned PR Recovery protocol documentation in `ORCHESTRATION.md`.
- Comprehensive bi-directional optimization bridge evaluations test suite and synthetic run log fixtures (`src/lib/evals.ts`, `tests/evals.test.ts`).
- Upstream contribution CLI test suite with mock executor and dry-run support (`tests/contribute.test.ts`).
- Downstream synchronization workflow and drift scenario test suite (`tests/sync-workflow.test.ts`).
- Dedicated `evals` CI workflow job in `.github/workflows/ci.yml` and `test:evals` npm script.
- Centralized cross-repo telemetry aggregation and token tracking hub (`jonah-fleet telemetry`).
- Routine telemetry JSON schema and parser (`RoutineTelemetrySummary`) supporting failure categories, duration, iterations, cost, and tokens.
- Global 70% weekly token budget ceiling tracking (~8.75M tokens/week) with utilization percentage, daily burn rates, and health badges (`[HEALTHY]`, `[WARNING]`, `[CRITICAL]`, `[EXCEEDED]`).
- Opt-in telemetry emission step in `autowork-cron.yml`, `trigger-review-routine.yml`, and `prompt-optimizer-cron.yml`.
- `telemetry` configuration block in `schema.json` and `agents-manifest.json`.
- Dedicated `trigger-autowork-manual.yml` workflow template for targeted on-demand Autowork runs via `workflow_dispatch` and issue badge links.
- Badge link format documentation in `templates/docs/AGENTS.template.md` and repository `AGENTS.md`.
- Default GitHub Issue Templates in `.github/ISSUE_TEMPLATE/` (`feature_request.md` and `bug_report.md`) embedding the Targeted Autowork badge link.
- `trigger-autowork-manual.yml` added to `ROUTINE_TO_WORKFLOW_MAP.autowork` for automatic installation and drift detection.
- Alias support for `issue_number` in `autowork-cron.yml` `workflow_dispatch` trigger.
- Explicit `token: ${{ secrets.GH_PAT || github.token }}` parameter in `release-please.yml` ensuring automated release PRs are authored with maintainer permissions to prevent workflow approval blocks.
- Release PR branch exclusion (`release-please--*`) in `trigger-review-routine.yml` workflow triggers, guard skip step, and `peer-review.md` prompt routines.
- Unit and drift tests in `tests/workflows-validation.test.ts` and `tests/installer.test.ts`.

## [1.2.0] - 2026-08-30

### Added
- Manual and comment-based (re)triggering for the Peer Review routine in `trigger-review-routine.yml`: supports `workflow_dispatch` (with optional `pr_number` for Targeted mode or blank for Scan mode), PR comment commands (`/review`, `/peer-review`, `/retrigger`, `/re-review`), and `review_requested` events with anti-loop bot guards.
- Automated release pipeline powered by Google Release Please (`.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`), automatically analyzing Conventional Commits on `main` to create release PRs, tag SemVer versions, and publish to npm via OIDC Trusted Publishing.
- Feedback Loop Stagnation token anomaly heuristic in `optimizer.md` and `ORCHESTRATION.md`: flags when downstream processing routines report 0 intake across >= 2 consecutive runs while upstream PRs/issues close.
- Loop Discovery Mechanical Audits remediation rule in `optimizer.md`: mandates deterministic per-issue matching tables and itemized reconciliation against upstream closed work.
- Closed-loop verification check in `issues-housekeeping.md`: audits recently closed roadmap/feature issues against tracking issues for projects operating impact or verification loops.
- Autonomous Issue Synthesis in `peer-review.md` and `ORCHESTRATION.md`: peer-review routine automatically synthesizes a tracking issue on GitHub (`gh issue create`) and links `Closes #N` (`gh pr edit`) before squash-merging unlinked contributor PRs, maintaining 100% issue auditability without human contributor friction.
- Documented required GitHub Actions workflow permissions and fork approval policies in `README.md` and post-init CLI output (`src/commands/init.ts`).
- Contributor PR lenience in `peer-review.md`: allow self-contained PR descriptions to serve as the spec for external contributions rather than blocking on missing `Closes #N` tracking issues.
- Per-agent token & cost aggregation protocol and scorecard schema in `optimizer.md` (`templates/prompts/optimizer.md` and `.github/prompts/optimizer.md`).
- Token Anomaly Heuristics in `optimizer.md`: defined concrete numerical thresholds for Token Surge (>50% week-over-week), Budget Hog (>75% fleet spend), Iteration Ceiling Exhaustion (>20% at `token_limit`), and Review Loop Burn (>= 3 bounce rounds).
- Automated preventative remediation actions and triggers in `optimizer.md` for instruction pruning, early exit/skip guards, iteration ceiling tuning, and ping-pong convergence.
- Documented fleet-wide Token Anomaly Triage & Remediation workflow in `ORCHESTRATION.md`.
- Prompt validation tests verifying token anomaly heuristics, automated remediation triggers, orchestration triage, and prompt template sync.
- Per-agent token and cost consumption breakdown in `src/lib/fleet-query.ts`, `src/lib/dashboard.ts`, `src/commands/status.ts`, and `src/commands/monitor.ts`.
- `--tokens` / `--detailed` CLI options for `jonah-fleet status` and `jonah-fleet monitor` to inspect granular per-routine token usage, iteration averages, and fleet spend share.
- Extended JSON telemetry with complete `byRoutine` metadata across repositories and fleet summaries.
- Per-routine token, cost, and iteration aggregation in `src/lib/fleet-query.ts` (`RoutineTokenSpend` and `TokenSpendInfo.byRoutine`).
- Support for extracting `iterationsUsed` and `duration` in `parseLogMetadata()`.
- Extended test coverage in `tests/fleet-query.test.ts` for per-routine token stats, fleet share calculation, and parsing edge cases.

## [1.1.1] - 2026-08-26

### Added
- Explicit OpenAI Symphony specification lineage documentation and conceptual mapping table.
- Architectural comparison matrix contrasting Jonah Fleet's zero-daemon GitHub-native model against persistent multi-agent runtimes (SwarmClaw).
- Synchronized template orchestration docs under `templates/prompts/ORCHESTRATION.md`.

## [1.1.0] - 2026-08-24


### Added
- Multi-repository fleet monitoring command (`jonah-fleet monitor` / `jonah-fleet status --fleet`).
- Global repository registry manager (`~/.jonah-fleet/config.json`) with `--add` and `--remove` CLI flags.
- Real-time active claim inspection and stale claim detection (> 6h with no open PR).
- 7-day rolling token spend tracking and cost estimation from routine run logs.
- Live watch mode (`--watch`, `--interval <sec>`) and JSON output (`--json`).

## [1.0.0] - 2026-08-24

### Added
- Extracted standalone `jonah-fleet` repository and distribution engine from Jonah-RuPaul.
- Created core generic prompts: `ORCHESTRATION.md`, `autowork.md`, `peer-review.md`, `optimizer.md`, `issues-housekeeping.md`, `dependency-update-security-check.md`, `product-planning.md`.
- Packaged core engineering skills: `tdd`, `code-review`, `codebase-design`, `domain-modeling`, `diagnosing-bugs`, `resolving-merge-conflicts`, `writing-for-agents`, `triage`, `to-spec`, `to-tickets`.
- Created standard workflow templates: `autowork-cron.yml`, `trigger-review-routine.yml`, `trigger-autowork-on-merge.yml`, `trigger-autowork-on-bug.yml`, `issues-housekeeping-cron.yml`, `prompt-optimizer-cron.yml`, `dependency-check-cron.yml`, and `sync-fleet.yml`.
- Built TypeScript CLI (`jonah-fleet`) with `init`, `sync`, `status`, and `contribute` commands.
- Implemented `schema.json` and `agents-manifest.json` configuration engine with preset bundling (`minimal`, `standard`, `full`).
- Implemented automated bi-directional improvement bridge in `optimizer.md` and `contribute` CLI command.
