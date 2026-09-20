# AGENTS.md (also GEMINI.md & CLAUDE.md)

## Project Overview

{Brief 1-2 paragraph description of the project, core capabilities, and target users.}

## Tech Stack

- **Framework / Language**: {e.g. Next.js 15, TypeScript strict mode, Python 3.12, Go 1.23}
- **Backend / Database**: {e.g. PostgreSQL, Supabase, SQLite, Redis}
- **Styling / UI**: {e.g. Tailwind CSS, Radix UI, CSS Modules}
- **Testing**: {e.g. Vitest, Playwright, Jest, pytest}
- **Deployment**: {e.g. Vercel, Cloudflare, Docker, AWS}
- **Package Manager**: {e.g. npm, pnpm, yarn, uv, pip}

## Development Workflows

```bash
npm run dev          # Start local development server
npm run build        # Production build
npm run lint         # ESLint / static linter
npm run type-check   # Type verification (tsc --noEmit)
npm test             # Run test suite
```

## Project Structure

```
src/
  app/            # App routes and views
  components/     # UI components
  lib/            # Domain logic and helpers
tests/            # Test suites
.agents/          # Local agent skills and configuration
.github/prompts/  # Autonomous agent routines (managed by jonah-fleet)
```

## Key Architecture Patterns

- **Separation of Concerns**: Keep business logic pure and isolated from UI rendering and framework adapters.
- **Error Handling**: Validate inputs at server and module boundaries. Return explicit structured errors.
- **Testing Philosophy**: Write regression unit tests for every bug fix and integration tests for key workflows.
- **The Red Gate Invariant**: Always execute a failing test or verifier before modifying code. If the check passes before changes, diagnose immediately whether the issue is already resolved or the test is a vacuous assertion.
- **Defect Taxonomy of Bogus Green Checks**: Interrogate verification against the 6 defect shapes (Vacuous assertion, Silent no-match, Errored check, Wrong reference, Stale premise, Scope mismatch). Always prove a positive before believing a negative.
- **Anti-Hallucination Disk Read-Back**: Verify generated code, configs, and artifacts by reading values directly back from the file on disk, never from in-memory variables or shell command echoes.
- **Precision Git Scoping**: Never run bare `git commit` or blind `git add .` in multi-agent environments. Scope commits explicitly (`git commit -m "..." -- <paths>`).
- **Autonomous Surfacing Cadence**: Timeboxing is for surfacing progress, never for stopping. Checkpoints report status without halting execution. Never yield the turn or ask rhetorical permission questions ("Shall I continue?").

## Requirements Discovery & Inquisitive Stance

- **Challenge Premise First**: Do not be a passive order-taker. Before writing code or drafting large plans, verify whether the requested change is necessary, whether it solves a root cause rather than a symptom, or if existing primitives in the codebase already handle it.
- **Zero-Guesswork Ambiguity Gate**: Never make silent assumptions about underspecified requirements, schemas, edge cases, or UX flows. Stop and ask clarifying questions before implementation.
- **Structured Clarifications & Grilling**: When asking questions, propose 1–2 high-leverage questions at a time with concrete options or trade-offs. For complex features or fuzzy requirements, invoke `/grill-me` to stress-test the design before writing code.

## Telemetry & Measurement Intent

- **Question-First Principle**: Every custom analytics event must answer an explicit question that influences a product, architectural, or growth decision. If observing an event would never change what is built, prioritized, or retired, do NOT instrument it.
- **3-Tier Telemetry Taxonomy**:
  - **Tier 1 (Core Funnel & Growth Levers)**: Acquisition, activation, retention, referral, revenue (North Star metrics). Instrumentation is **mandatory and rigorous**: must include impression denominator (`_shown`), interaction CTA (`_clicked`), outcome/completion (`_completed`), and structured failure/abandonment branches (`_failed` with `reason`). Must pair with a companion `Measure: ...` tracking issue.
  - **Tier 2 (Exploratory Product UX & Feature Flags)**: Secondary features and discovery surfaces. Instrument only when tied to an explicit hypothesis or UX discovery question in the issue specification.
  - **Tier 3 (Passive Chrome & Utility / Easter Eggs)**: Cosmetic toggles, credits popovers, dismiss buttons, informational tooltips. **Explicitly exempt from custom events**; rely on autocapture, web vitals, or session replay if diagnostic data is ever needed.
- **Zero Vanity Tracking Guardrail**: Never emit telemetry purely for checklist compliance. Avoid adding arbitrary click trackers to passive or cosmetic UI surfaces.

## Conventions

- **Language**: All code, comments, commit messages, and PR titles must be written in **English**.
- **Changelog**: Append user-facing changes to `CHANGELOG.md` under today's date section.
- **Antigravity Run Footer**: Every GitHub comment, issue edit, and PR description posted by automated Actions must end with `_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})_`.

## Autonomous Agent Dispatch (Targeted Autowork)

To trigger the Autowork routine manually on any specific issue, use the GitHub Actions `workflow_dispatch` trigger or embed this badge link in issue templates/descriptions:

```markdown
[![Trigger Autowork](https://img.shields.io/badge/Autowork-Run_Targeted-blue?style=for-the-badge&logo=githubactions)](https://github.com/OWNER/REPO/actions/workflows/trigger-autowork-manual.yml)
```

## Design System & UI Guardrails

- **Design Token Purity**: Use standard design system tokens and scale classes. Avoid arbitrary values (e.g. `text-[...px]`, `w-[...px]`) and bespoke inline overrides.
- **Accessibility & Contrast**: Enforce WCAG AA 4.5:1 minimum text contrast across light and dark themes (e.g. avoid unreadable low-contrast text on dark backgrounds).
- **CTA & Visual Hierarchy**: Maintain at most one primary forward action button (`.btn-primary`) per view/tab to prevent choice paralysis.
- **Viewport Density & Nudge Budget**: Ensure banners, nudges, and sticky elements do not stack concurrently or crowd mobile viewports (~390px above the fold).

## Security Guidelines

- Auth boundaries required for all sensitive mutations.
- Never commit credentials, tokens, or secret keys to version control.
- Validate request inputs and sanitize outputs.
