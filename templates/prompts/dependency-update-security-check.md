# Dependency Update & Security Check

## Objective

Check all dependencies for available updates and known security vulnerabilities, report findings grouped by severity, and create or update GitHub issues for actionable items. Security vulnerabilities are highest priority — a vulnerability is actionable even when the affected dependency is not outdated (e.g. a transitive dependency, or an advisory with no fix released yet).

## Definition of Done

The run is SUCCESS only if ALL of these are true:

- [ ] Ran the project package manager's outdated check (`npm outdated`, `pip list --outdated`, `cargo outdated`, etc.) and collected outdated dependencies
- [ ] Ran dependency security audit (`npm audit`, `pip-audit`, `cargo audit`, etc.) and collected known vulnerabilities (including transitive dependencies)
- [ ] For each outdated dependency, determined: current vs latest version, update type (major/minor/patch), breaking changes, and security advisories
- [ ] For each vulnerability, determined: affected package, severity, direct vs transitive, and fixed version availability
- [ ] Created or updated a GitHub issue for each vulnerability and each major update
- [ ] If everything is up to date and no vulnerabilities were found, logged SUCCESS with "All dependencies current, no known vulnerabilities"

If any criterion cannot be met, stop immediately and log FAILURE with the reason.

## Constraints

- **Max iterations**: 30 — after 30 tool call rounds without completing Definition of Done, STOP. Log FAILURE with category `token_limit`.
- **Max scope**: report and issue creation only. Do not open code PRs in this routine.
- **No speculative work**: check dependencies declared in the project's manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`).
- **Language Requirement**: All GitHub issue titles, descriptions, task checklists, and comments MUST be written in **English**.

## Instructions

1. Run the outdated dependencies check for the repository's package manager.
2. Run the security audit command to check for known CVEs/GHSA vulnerabilities across direct and transitive dependencies.
3. For each outdated package, check current vs latest version and note breaking changes for major bumps.
4. For each vulnerability, extract severity, package name, and remediation version.
5. Search existing open issues before creating new ones to prevent duplicate tracking.
6. Create or update issues with clear labels: `security` and `priority/P1` for known CVEs; `dependencies` and `priority/P3` for non-security major updates.
7. If all dependencies are current and no vulnerabilities exist, confirm clean status.

## Logging

After completing (SUCCESS or FAILURE), record run execution details to `.jonah-fleet/run-report.md`. Include:
- Prompt SHA
- Tally of audited dependencies and security findings
- List of created or updated issues

**Issue Logging Protocol**:
- Record run execution details to `.jonah-fleet/run-report.md` (or update `$ROUTINE_ISSUE_NUMBER`).
- Follow the Routine Issue Logging & Telemetry Protocol in `ORCHESTRATION.md`. Never commit run logs to git branches.
