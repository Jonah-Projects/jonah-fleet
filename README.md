# ⚓ Jonah Fleet

> **Standalone Autonomous Agent Fleet & Symphony Orchestration Engine**  
> Battle-tested autonomous coding agents, claim protocols, review loops, and engineering skills for multi-repo teams.

[![CI](https://github.com/Jonah-Projects/jonah-fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/Jonah-Projects/jonah-fleet/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Overview

`jonah-fleet` packages a complete suite of autonomous software engineering agents into a standalone repository and zero-install CLI (`npx jonah-fleet`). It turns any repository into an autonomous agent-driven development environment with:

- **Symphony-aligned Orchestration**: Built on the principles formalized by OpenAI's [Symphony spec](https://github.com/openai/symphony/blob/main/SPEC.md) — single-flight locking, dead-run claim recovery, reader/writer separation, and warm-session review loops.
- **Autonomous Autowork**: Issue claiming, test-driven implementation (`/tdd`), automated draft PR creation, and warm-session review synchronization.
- **Strict Peer Review**: Multi-angle subagent code reviews (`/code-review`), security scanning, and automated squash-merge.
- **Issues Housekeeping & Dependency Security**: Weekly automated sweeps for duplicate detection, triage label assignment, and vulnerability remediation.
- **Continuous Bi-Directional Improvement Bridge**: When local `optimizer.md` routines discover generic prompt optimizations, fixes can be submitted directly back upstream to `jonah-fleet` and distributed to all projects.

---

## 🏛️ Architecture: The Symphony Lineage

Jonah Fleet is a **GitHub-native implementation of OpenAI's [Symphony specification](https://github.com/openai/symphony/blob/main/SPEC.md)** for orchestrating autonomous coding agents against issue trackers. 

Rather than requiring a persistent orchestrator daemon or complex server infrastructure, Jonah Fleet maps all Symphony primitives directly onto GitHub and ephemeral CLI agent sessions:

| Symphony Concept | Jonah Fleet Implementation |
|---|---|
| **`WORKFLOW.md`** (Repo config & prompt templates) | `AGENTS.md` (aliased as `GEMINI.md`/`CLAUDE.md`) + `.github/prompts/*.md` |
| **Orchestrator** (Poll, dispatch, reconcile) | GitHub Actions event triggers + scheduled cron routines (zero persistent daemons) |
| **Issue Tracker** | GitHub Issues with single-flight claim protocols (`🔒` claim comments) |
| **Agent Runner** | Ephemeral agent sessions (**Antigravity CLI `agy`** via Gemini 3.7 Flash) in fresh clones |
| **Reader/Writer Separation** | Autowork authors PRs; Peer Review routine is sole merge authority for product PRs |
| **Warm-Context Synchronization** | In-session polling & live fix loops between Autowork and Peer Review before merge |
| **Dead-Run Recovery** | Stale claim detection (>6h without live PR) via autowork & issues-housekeeping sweeps |

### Architectural Comparison: Jonah Fleet vs. SwarmClaw

| Dimension | ⚓ Jonah Fleet | 🦞 SwarmClaw (`@swarmclawai/swarmclaw`) |
|---|---|---|
| **Paradigm** | **Symphony-aligned, issue-driven workflow automation** | **Self-hosted multi-agent runtime & swarm platform** |
| **Runtime Model** | Ephemeral CLI sessions (`agy`) spun up per issue/PR | Persistent daemon / Electron desktop app / server |
| **State & Coordination** | GitHub Issues, PR labels, commit status checks, and run logs | Local SQLite / Postgres, live WebSockets, durable agent memory |
| **Agent Topology** | Specialized asynchronous routines (Autowork, Peer Review, Housekeeping, Optimizer) | Interactive agent teams, live org charts, and hierarchical delegation |
| **Best For** | Production software engineering pipelines & automated multi-repo maintenance | Interactive agent chat, local tool runtimes, multi-provider desktop UI |


---

## 🚀 Quickstart

### 1. Initialize a repository

Inside any project directory, run:

```bash
npx jonah-fleet init --preset standard
```

Available presets:
- **`minimal`**: `autowork` + `peer-review` + `optimizer`
- **`standard`** (default): minimal + `issues-housekeeping` + `dependency-update-security-check`
- **`full`**: standard + `product-planning` + `analytics-review`

### 2. Configure GitHub Actions Permissions

To ensure agent workflows can create and merge PRs and run without getting stuck awaiting approval:

1. **Workflow permissions**: Go to **Settings** → **Actions** → **General** → **Workflow permissions**, choose **"Read and write permissions"**, and check **"Allow GitHub Actions to create and approve pull requests"**.
2. **Fork pull request workflows**: Under **Actions** → **General** → **Fork pull request workflows**, configure the workflow approval policy (*e.g.* **"Require approval for first-time contributors"** or **"Run workflows without approval"** for private/internal repositories) to prevent automated runs from stalling awaiting manual approval.

### 3. Configure project context (`AGENTS.md`)

`jonah-fleet init` generates an `AGENTS.md` file (or uses your existing one). Specify your test commands, build scripts, and architecture patterns:

```markdown
## Tech Stack
- Next.js 15, TypeScript, Tailwind CSS, Supabase

## Development Workflows
```bash
npm run build
npm test
npm run type-check
```
```

### 4. Check health and drift

To inspect which routines and skills are active or verify alignment with latest fleet updates:

```bash
npx jonah-fleet status
```

To synchronize with the latest fleet version:

```bash
npx jonah-fleet sync
```

### 5. Multi-repo Fleet Monitoring

Monitor health, in-flight autowork claims, open PR review loops, and token usage across your entire fleet:

```bash
# Register repositories to your fleet registry
npx jonah-fleet monitor --add juliendurandeu/Jonah-RuPaul
npx jonah-fleet monitor --add juliendurandeu/jonah-newsletter-gemini

# View terminal dashboard
npx jonah-fleet monitor

# Live watch mode with auto-refresh
npx jonah-fleet monitor --watch --interval 10

# Output as JSON
npx jonah-fleet monitor --json
```

---

## 🛠️ Repository Layout

```
jonah-fleet/
├── templates/
│   ├── prompts/          # Core generic prompts (autowork, peer-review, optimizer, etc.)
│   ├── workflows/        # GitHub Actions workflows for scheduling and event triggers
│   ├── skills/           # Reusable engineering skills (tdd, code-review, diagnosing-bugs, etc.)
│   └── docs/             # Starter documentation templates (AGENTS.template.md)
├── src/                  # TypeScript CLI source code
├── tests/                # Unit test & prompt validation suite
└── schema.json           # JSON Schema for agents-manifest.json
```

---

## 📜 Manifest Configuration (`agents-manifest.json`)

Each target project contains an `agents-manifest.json` at its root:

```json
{
  "$schema": "https://raw.githubusercontent.com/Jonah-Projects/jonah-fleet/main/schema.json",
  "version": "1.6.0",
  "preset": "standard",
  "routines": {
    "autowork": true,
    "peer-review": true,
    "optimizer": true,
    "issues-housekeeping": true,
    "dependency-update-security-check": true,
    "product-planning": false,
    "analytics-review": false
  },
  "models": {
    "default": "gemini-3.8-flash-high",
    "issues-housekeeping": "gemini-3.8-flash-medium",
    "dependency-update-security-check": "gemini-3.8-flash-medium"
  },
  "budgets": {
    "weeklyTokens": 8750000,
    "timeoutMinutes": {
      "autowork": 60,
      "peer-review": 55,
      "optimizer": 35,
      "issues-housekeeping": 40,
      "dependency-update-security-check": 25
    },
    "maxIterations": {
      "autowork": 65,
      "peer-review": 40,
      "optimizer": 30,
      "issues-housekeeping": 30,
      "dependency-update-security-check": 20
    }
  },
  "skills": [
    "tdd",
    "code-review",
    "codebase-design",
    "domain-modeling",
    "diagnosing-bugs",
    "resolving-merge-conflicts",
    "writing-for-agents",
    "triage",
    "grill-me"
  ],
  "autoUpdate": {
    "enabled": true,
    "channel": "stable"
  }
}
```

---

## 🔄 Bi-Directional Continuous Improvement

1. **Local Optimization**: The `optimizer.md` routine monitors run logs in each connected project.
2. **Upstream Contribution**: When a prompt or workflow improvement is discovered, the optimizer opens an upstream PR against `Jonah-Projects/jonah-fleet` (or via `npx jonah-fleet contribute`).
3. **Downstream Sync**: Merged improvements in `jonah-fleet` create a semantic release, and downstream consumer repositories receive automated update PRs via `.github/workflows/sync-fleet.yml`.

---

## 🙏 Acknowledgments & Credits

- **[OpenAI Symphony](https://github.com/openai/symphony)**: Jonah Fleet's orchestration architecture, single-flight claim locking, reader/writer separation, and prompt engineering protocols are inspired by OpenAI's [Symphony Specification](https://github.com/openai/symphony/blob/main/SPEC.md), licensed under [Apache-2.0](https://github.com/openai/symphony/blob/main/LICENSE). See [NOTICE](./NOTICE) for formal attribution.

---

## 📄 License

MIT © Julien Durand
