# AGENTS.md (also GEMINI.md & CLAUDE.md)

## Project Overview

`jonah-fleet` is the centralized repository and distribution CLI for the Jonah autonomous agent fleet. It provides Symphony-aligned prompt routines, claim protocols, engineering skills, and GitHub Actions workflows to turn any repository into an autonomous agent-driven development environment.

## Tech Stack

- **Runtime / Language**: Node.js >= 22.0.0 with TypeScript (strict mode, NodeNext module resolution)
- **CLI Framework**: Commander.js with `picocolors`
- **Bundler**: `tsup` (generating ESM bundle and TypeScript declarations in `dist/`)
- **Testing**: Vitest (`vitest`) for unit tests, drift checks, and prompt invariant validations
- **Package Manager**: npm (lockfile committed)
- **CI / CD**: GitHub Actions with Google Release Please and native OIDC npm Trusted Publishing

## Development Workflows

```bash
npm run dev          # Watch mode build (tsup --watch)
npm run build        # Production build (tsup)
npm run type-check   # TypeScript type check (tsc --noEmit)
npm test             # Run Vitest test suite once
npm run test:watch   # Vitest in watch mode
```

## Project Structure

```
src/
  commands/       # CLI commands (init, sync, status, contribute)
  lib/            # Fleet manifest, installer, drift detector, preset configs
  index.ts        # CLI entrypoint
templates/
  prompts/        # Core generic prompt routines (autowork, peer-review, optimizer, etc.)
  workflows/      # GitHub Actions workflows distributed to consumer repositories
  skills/         # Reusable engineering skills (.agents/skills/*)
  docs/           # Documentation templates (AGENTS.template.md)
tests/            # Unit and prompt validation test suites
schema.json       # JSON Schema for agents-manifest.json
```

## Key Architecture Patterns

- **Pure Generic Prompts**: Prompts in `templates/prompts/` are 100% repository-agnostic and dynamically ingest project commands and conventions from the consumer repo's `AGENTS.md`.
- **Manifest-Driven Installation**: Target projects configure enabled routines and skills via `agents-manifest.json`.
- **Model Family Discipline**: Always track the latest version strictly within a model's designated family (e.g. Flash stays on Flash). Never substitute across model tiers (e.g. Flash to Pro) because fleet throughput, latency, and weekly token budgets are calibrated specifically for Flash.
- **Drift Detection**: `jonah-fleet sync` and `jonah-fleet status` compare local project prompt/workflow files against fleet templates to surface updates and drifts.
- **Bi-directional Bridge**: `optimizer.md` in consumer projects proposes generic orchestrator enhancements upstream to `jonah-fleet`.

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

- **Language**: All code, documentation, prompt templates, and issues MUST be written in **English**.
- **Changelog**: Append user-facing changes to `CHANGELOG.md` under today's date section following Keep a Changelog.
- **Antigravity Run Footer**: Every GitHub comment, issue edit, and PR description posted by automated Actions must end with `_Generated by [Antigravity](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})_`.

## Autonomous Agent Dispatch (Targeted Autowork)

To trigger the Autowork routine manually on any specific issue, use the GitHub Actions `workflow_dispatch` trigger or embed this badge link in issue templates/descriptions:

```markdown
[![Trigger Autowork](https://img.shields.io/badge/Autowork-Run_Targeted-blue?style=for-the-badge&logo=githubactions)](https://github.com/juliendurandeu/jonah-fleet/actions/workflows/trigger-autowork-manual.yml)
```

## Design System & UI Guardrails

- **Design Token Purity**: Adhere strictly to project-defined design tokens and CSS/Tailwind utilities. Avoid arbitrary sizing or bespoke button styling.
- **Accessibility & Contrast**: Verify WCAG AA 4.5:1 minimum contrast on all readable text surfaces.
- **CTA & Visual Hierarchy**: Maintain a single primary forward CTA per view/tab to prevent decision fatigue.
- **Viewport Density & Nudge Budget**: Prevent visual crowding by ensuring persistent banners, cards, or nudges do not stack concurrently above the fold on mobile viewports (~390px).

## Security Guidelines

- Zero hardcoded secrets, API keys, or tokens in source code or template prompts.
- All Actions use least-privilege tokens and OIDC trusted publishing.
