# RepoGuardAI

> Tool-independent repository auditing framework that guides **any** AI coding
> agent — Codex, Claude Code, Cursor, Gemini CLI, or another — through a
> repeatable, evidence-driven security and code audit.

[![CI](https://github.com/SUDARSHANCHAUDHARI/RepoGuardAI/actions/workflows/ci.yml/badge.svg)](https://github.com/SUDARSHANCHAUDHARI/RepoGuardAI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10-orange.svg)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

RepoGuardAI inspects any software repository, runs whichever security and
dependency scanners you already have installed **plus its own deterministic
scanners**, and generates precise, evidence-driven instructions that drive a
coding agent to review the code for bugs, security vulnerabilities, API security
issues, missing rate limiting, dependency risk, configuration problems, and
missing tests.

It is **not** tied to any AI provider. The deterministic work runs locally; the
reasoning is delegated to whichever agent runs the generated instructions.

---

## Table of contents

- [Why](#why)
- [Design: deterministic first, AI second](#design-deterministic-first-ai-second)
- [The pipeline](#the-pipeline)
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Command reference](#command-reference)
- [Output layout](#output-layout)
- [Finding schema](#finding-schema)
- [Configuration](#configuration)
- [What gets scanned](#what-gets-scanned)
- [Supported agents](#supported-agents)
- [CI / SARIF integration](#ci--sarif-integration)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Safety guarantees](#safety-guarantees)
- [Limitations](#limitations)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why

Pointing an LLM at a whole repo and asking "find the bugs" is unreliable: it
hallucinates findings, misses what tools would catch, and gives you different
results every run. RepoGuardAI fixes that by splitting the work:

- **Deterministic tools** do the objective checks (secrets, dependency hygiene,
  route inventory, config flags, headers, CVEs) — repeatable, no hallucination.
- **The AI agent** does what tools can't: architecture, business logic,
  authorization, code flow, and **validating or rejecting** every lead with
  concrete `file:line` evidence.

The result is a consistent, auditable process regardless of which agent you run.

## Design: deterministic first, AI second

```
Automated scanners  →  Collected evidence  →  AI code review  →  Finding validation  →  Final report
```

Every finding must carry code evidence (`file:line`). The in-house scanners
**never** emit `confirmed` — they surface `potential` / `manual-verification`
leads for the agent to prove or reject.

## The pipeline

1. **Discovery** — languages, frameworks, package managers, API/test frameworks,
   databases, integrations, CI, Docker/infra, auth and config files, and a
   best-effort API route inventory. → `discovery.json`
2. **Evidence** — external scanners (when installed) + six in-house scanners,
   fused with the enriched API inventory. → `evidence.json`
3. **Instructions** — agent-specific playbooks assembled from the prompt library
   and YAML rule packs, injected with discovery + evidence context. →
   `instructions/<agent>-instructions.md`
4. **AI review** — the agent validates leads, finds what scanners miss, and
   writes `findings.json`.
5. **Validation & report** — deterministic threshold pass, then Markdown, JSON,
   and SARIF reports. → `reports/audit-report.{md,json,sarif}`

## Features

- 🔌 **Provider-neutral** — works with Codex, Claude Code, Cursor, Gemini CLI, or
  any agent that can read files.
- 🧰 **9 external scanners**, availability-gated — gitleaks, semgrep, trivy,
  osv-scanner, npm/pnpm audit, pip-audit, govulncheck, cargo-audit. Never
  installed automatically; unavailable ones are skipped, not fatal.
- 🔎 **6 in-house deterministic scanners** — secrets, dependencies, routes,
  permissions, configuration, security-headers. Zero external dependencies.
- 📋 **15 YAML rule packs** across security, API, and quality.
- 🧭 **API inventory** with honest control detection (`?` when a control isn't
  visible — never a false claim).
- 🧱 **Zod-validated** artifacts + JSON Schema mirrors.
- 📄 **Markdown + JSON + SARIF** reports (upload SARIF to GitHub code scanning).
- 🛡️ **Read-only by default** — never modifies the repo under audit.
- ✅ **Strict TypeScript**, 36 tests, CI on Node 18/20/22.

## Requirements

- Node.js ≥ 18
- pnpm

External scanners are **optional** and detected at runtime — install any of them
to add coverage:
[gitleaks](https://github.com/gitleaks/gitleaks) ·
[semgrep](https://semgrep.dev/) ·
[trivy](https://github.com/aquasecurity/trivy) ·
[osv-scanner](https://github.com/google/osv-scanner) ·
`npm audit` · `pnpm audit` ·
[pip-audit](https://github.com/pypa/pip-audit) ·
[govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck) ·
[cargo-audit](https://github.com/rustsec/rustsec).

## Install

```bash
git clone https://github.com/SUDARSHANCHAUDHARI/RepoGuardAI.git
cd RepoGuardAI
pnpm install
pnpm build
pnpm link --global   # optional: expose the `repoguard` binary globally
```

Run without building during development:

```bash
pnpm dev -- discover ../some-repo   # tsx src/cli.ts discover ../some-repo
```

## Quick start

```bash
# Full pipeline against a target repo
repoguard audit /path/to/target-repo

# Point your agent at the generated instructions, e.g. open in Claude Code:
#   /path/to/target-repo/repoguard-results/instructions/claude-instructions.md
# The agent validates findings and writes repoguard-results/findings.json

# Then finalize:
repoguard validate /path/to/target-repo
repoguard report   /path/to/target-repo
```

## Command reference

| Command | Description |
| --- | --- |
| `repoguard init [repo]` | Create the output workspace and a starter `repoguard.config.yaml`. |
| `repoguard discover <repo>` | Detect stack, APIs, config; write `discovery.json`. |
| `repoguard scan <repo> [--security] [--api]` | Run external + in-house scanners; write `evidence.json`. |
| `repoguard instructions <repo> --agent <a>` | Generate instructions for `codex`, `claude`, `cursor`, `gemini`, or `generic`. |
| `repoguard audit <repo> [--security] [--api]` | Full pipeline: discover → evidence → instructions → report. |
| `repoguard validate [repo]` | Deterministic pass that reclassifies low-confidence potentials (< `minimumConfidence`). |
| `repoguard report [repo]` | Rebuild `audit-report.{md,json,sarif}` from existing artifacts. |
| `repoguard fix <finding-id> [repo]` | Generate a remediation plan for one finding (never edits code unless `mode.modifyFiles`). |

**Scope flags:** `--security` limits a run to security + dependency + config
checks; `--api` limits it to API-security + rate-limiting checks. Both override
the `audit.*` toggles for that run only.

### Examples

```bash
repoguard init
repoguard discover .
repoguard scan . --security
repoguard instructions . --agent codex
repoguard audit ../my-api --api
repoguard fix RG-AUTH-001 ../my-api
```

## Batch / portfolio scripts

Helper scripts in [`scripts/`](scripts/) run RepoGuard across many repos at once.
Point them at a directory that contains your repos (or category folders) via
`REPOGUARD_ROOT` (defaults to the current directory):

```bash
# audit every repo under a directory, writing repoguard-results/ into each
REPOGUARD_ROOT=~/code ./scripts/portfolio-audit.sh

# safe, in-range dependency refresh (pnpm update + dedupe) + audit delta
REPOGUARD_ROOT=~/code ./scripts/dependency-sweep.sh --criticals

# AI deep-pass: have Claude Code validate seed findings into findings.json
#   (restricted to read + write-file tools, per-repo $ budget cap)
cd some-repo && ./scripts/claude-deep-pass.sh
```

These are optional convenience wrappers around the core `repoguard` CLI.

## Output layout

```
repoguard-results/
├── discovery.json                     # detected stack + raw API endpoints
├── evidence.json                      # external + in-house scanner output + API inventory + seed findings
├── findings.json                      # seeded from evidence; the agent overwrites this
├── scans/
│   ├── scan-report.json
│   └── <tool>.stdout.txt / <tool>.stderr.txt
├── instructions/
│   ├── codex-instructions.md
│   ├── claude-instructions.md
│   ├── cursor-instructions.md
│   ├── gemini-instructions.md
│   └── generic-instructions.md
├── reports/
│   ├── audit-report.md
│   ├── audit-report.json
│   └── audit-report.sarif
└── fixes/
    └── <finding-id>.md                # from `repoguard fix`
```

## Finding schema

Agents write `repoguard-results/findings.json`:

```json
{
  "repository": "/path/to/target-repo",
  "generatedAt": "2026-07-12T00:00:00.000Z",
  "findings": [
    {
      "id": "RG-AUTH-001",
      "title": "Login endpoint has no rate limiting",
      "severity": "high",
      "category": "api-security",
      "status": "confirmed",
      "confidence": 95,
      "file": "src/routes/auth.ts",
      "line": 42,
      "endpoint": "POST /api/login",
      "description": "The login endpoint accepts unlimited authentication attempts.",
      "evidence": "No rate-limit middleware is applied to the route or router.",
      "impact": "An attacker can perform credential-stuffing or brute-force attacks.",
      "triggerCondition": "Repeated POST /api/login requests from one client.",
      "reproduction": ["Send repeated invalid logins", "Observe no throttling"],
      "recommendedFix": "Apply a distributed limiter keyed on account + client IP."
    }
  ]
}
```

| Field | Values |
| --- | --- |
| `severity` | `critical` · `high` · `medium` · `low` · `informational` |
| `status` | `confirmed` · `potential` · `manual-verification` · `rejected` |
| `category` | `bug` · `security` · `api-security` · `authentication` · `authorization` · `rate-limiting` · `dependency` · `configuration` · `secrets` · `test-coverage` · `other` |
| `id` | `RG-<AREA>-<NNN>`, e.g. `RG-AUTH-001` |

Validated with Zod (`src/schemas.ts`) and mirrored as JSON Schema in
[`schemas/finding.schema.json`](schemas/finding.schema.json). Invalid
`findings.json` is ignored with a warning rather than corrupting the report.

## Configuration

Optional `repoguard.config.yaml` in the target repo. All keys are optional; see
[`repoguard.config.example.yaml`](repoguard.config.example.yaml) and
[`schemas/config.schema.json`](schemas/config.schema.json).

```yaml
project:
  name: auto
  repository: .
audit:                    # per-area toggles
  bugs: true
  security: true
  apiSecurity: true
  rateLimiting: true
  dependencies: true
  configuration: true
  tests: true
mode:
  modifyFiles: false      # RepoGuard never edits files unless this is true
  validateFindings: true
  minimumConfidence: 75   # `validate` reclassifies potentials below this
exclude: [node_modules, dist, build, coverage, vendor, .git]
report:
  formats: [markdown, json, sarif]
  outputDirectory: repoguard-results
scanners:
  disabled: []            # e.g. [semgrep, trivy]
  timeoutMs: 120000
discovery:
  maxFiles: 200000
  maxEndpointScanFiles: 5000
```

## What gets scanned

**In-house scanners** (`scanners/`, no external deps):

| Scanner | Checks |
| --- | --- |
| `secrets` | Committed API keys, tokens, private keys (placeholder-aware). |
| `dependencies` | Floating versions (`*`/`latest`), missing lockfiles. |
| `routes` | API route inventory + sensitive endpoints lacking visible auth/limits. |
| `permissions` | Absence of any authorization/ownership checks across the code. |
| `configuration` | TLS verification off, wildcard CORS, debug mode, insecure cookies. |
| `security-headers` | Missing helmet / HTTP security headers in Node HTTP apps. |

**Rule packs** (`rules/`), summarized into the agent instructions:

- `security/` — authentication, authorization, injection, secrets, file-upload, sensitive-data
- `api/` — rate-limiting (incl. bypass vectors), request-limits, pagination, cors, error-responses
- `quality/` — bugs, race-conditions, error-handling, test-coverage

## Supported agents

`codex` · `claude` · `cursor` · `gemini` · `generic`. Each gets a tailored
adapter (`adapters/`) plus the shared prompt library and rule packs.

| Agent | Reads |
| --- | --- |
| **Codex** | `AGENTS.md`, `CODEX.md`, `repoguard-results/instructions/codex-instructions.md` |
| **Claude Code** | `CLAUDE.md`, `AGENTS.md`, `repoguard-results/instructions/claude-instructions.md` |
| **Others** | `repoguard instructions <repo> --agent generic` → one combined prompt |

## CI / SARIF integration

`audit-report.sarif` is SARIF 2.1.0 — upload it to GitHub code scanning:

```yaml
- run: npx repoguard audit .
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: repoguard-results/reports/audit-report.sarif
```

This repo's own CI (`.github/workflows/ci.yml`) runs typecheck, tests, and build
on Node 18/20/22 for every push and PR.

## Repository layout

```
prompts/    reusable review steps (system-audit, bug, api-security, rate-limiting, …)
rules/      declarative YAML rule packs (security/, api/, quality/)
adapters/   per-agent operating instructions (codex, claude-code, cursor, gemini-cli, generic)
scanners/   in-house deterministic scanners + shared util
schemas/    JSON Schema mirrors of finding / audit / config
templates/  report, finding, and remediation-plan templates
src/        cli, discovery, scanner-runner, evidence-collector, agent-instructions,
            report-generator, schemas, types, config
tests/      vitest suites
```

## Development

```bash
pnpm typecheck    # tsc --noEmit (strict)
pnpm test         # vitest run  (36 tests)
pnpm build        # tsup -> dist/
```

Extend the design without touching unrelated code:

- **External scanner** → add to `SCANNERS` in `src/scanner-runner.ts`.
- **In-house scanner** → add to `INTERNAL_SCANNERS` in `scanners/index.ts`.
- **Agent** → add an adapter in `adapters/` and wire `ADAPTER_FILE` in
  `src/agent-instructions.ts`.
- **Data shape** → change the Zod schema in `src/schemas.ts` first, then the code.

## Safety guarantees

- Never modifies the repository under audit (read-only; `fix` writes a plan, not
  code, unless `mode.modifyFiles` is enabled).
- Never installs scanners automatically.
- Skips unavailable / disabled / non-applicable scanners without failing the run.
- Excludes its own output directory from scanning (no self-pollution).
- In-house scanners never emit `confirmed` — only validatable leads.
- Instructions forbid claiming a vulnerability confirmed without code evidence
  and require separating Confirmed / Potential / Manual-verification / Rejected.

## Limitations

- Static analysis only; the target app is never executed.
- API discovery and control detection are lexical scans of common Node patterns —
  other frameworks or dynamically-built routes may be missed, and a control is
  marked present only when visible on the route line (otherwise `?` = verify).
- Access-control, tenant-isolation, and business-logic depth depend on the
  driving agent.
- A clean report does not certify a repository as secure — see [SECURITY.md](SECURITY.md).

## Roadmap

- ✅ Parse external scanner JSON (semgrep, gitleaks, npm/pnpm audit, osv-scanner,
  trivy) into structured seed findings.
- Route extractors for Python / Go / Rust / Java frameworks (currently Node only).
- Packaged GitHub Action + `--fail-on <severity>` exit gate.
- Config-declared custom scanners without code changes.
- Diff-only audit mode for pull requests.

## License

[MIT](LICENSE) © 2026 Sudarshan Chaudhari (SudarshanTechLabs)
