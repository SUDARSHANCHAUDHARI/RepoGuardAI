# RepoGuardAI

Tool-independent repository auditing framework. RepoGuardAI inspects any
software repository, runs whichever security and dependency scanners you already
have installed **plus its own deterministic scanners**, and generates precise,
evidence-driven instructions that guide a coding agent — **Codex, Claude Code,
Cursor, Gemini CLI, or any other** — to review the code for bugs, security
vulnerabilities, API security issues, missing rate limiting, dependency risk,
configuration problems, and missing tests.

It is **not** tied to any AI provider. The deterministic work runs locally; the
reasoning is delegated to whichever agent runs the generated instructions.

## Design: deterministic first, AI second

```
Automated scanners  →  Collected evidence  →  AI code review  →  Finding validation  →  Final report
```

Regular tools do the deterministic checks (secrets, dependency hygiene, route
inventory, config flags, headers). The AI does what scanners can't: architecture,
business logic, authorization, code flow, and validating or rejecting the leads.
Every finding must carry code evidence (`file:line`).

## Pipeline

1. **Discovery** — languages, frameworks, package managers, API/test frameworks,
   databases, integrations, CI, Docker/infra, auth, config files, and a
   best-effort API route inventory.
2. **Evidence** — external scanners (when installed) + six in-house scanners,
   fused into `evidence.json` with seed findings (always `potential` /
   `manual-verification`, never `confirmed`).
3. **Instructions** — agent-specific playbooks assembled from the prompt library
   and the YAML rule packs, injected with discovery + evidence context.
4. **AI review** — the agent validates leads, finds what scanners miss, and
   writes `findings.json`.
5. **Report** — Markdown, JSON, and SARIF, assembled from validated findings.

## Requirements

- Node.js ≥ 18, pnpm

External scanners are **optional** and detected at runtime — RepoGuard skips the
ones you don't have and never installs anything:
[gitleaks](https://github.com/gitleaks/gitleaks),
[semgrep](https://semgrep.dev/),
[trivy](https://github.com/aquasecurity/trivy),
[osv-scanner](https://github.com/google/osv-scanner),
`npm audit`, `pnpm audit`,
[pip-audit](https://github.com/pypa/pip-audit),
[govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck),
[cargo-audit](https://github.com/rustsec/rustsec).

The **in-house scanners** (secrets, dependencies, routes, permissions,
configuration, security-headers) run with no external dependencies.

## Install

```bash
pnpm install
pnpm build
pnpm link --global   # optional: expose the `repoguard` binary
```

During development, run without building:

```bash
pnpm dev -- discover ../some-repo
```

## Usage

```bash
repoguard init                                     # scaffold output dir + config
repoguard discover <repository>                    # write discovery.json
repoguard scan <repository> [--security] [--api]   # run scanners → evidence.json
repoguard instructions <repository> --agent codex  # codex|claude|cursor|gemini|generic
repoguard audit <repository> [--security] [--api]  # full pipeline
repoguard validate [repository]                    # threshold pass over findings
repoguard report [repository]                       # rebuild md/json/sarif
repoguard fix RG-AUTH-001 [repository]             # generate a remediation plan
```

### Typical flow

```bash
repoguard audit /path/to/target-repo
```

produces:

```
repoguard-results/
  discovery.json
  evidence.json
  scans/scan-report.json
  scans/<tool>.stdout.txt / .stderr.txt
  instructions/{codex,claude,cursor,gemini,generic}-instructions.md
  findings.json                 # seeded from evidence; the agent overwrites it
  reports/audit-report.{md,json,sarif}
  fixes/<finding-id>.md         # from `repoguard fix`
```

Point your agent at the matching instructions file (e.g. open
`repoguard-results/instructions/claude-instructions.md` in Claude Code). The
agent validates the seed findings, adds what it finds, and writes
`repoguard-results/findings.json`. Then:

```bash
repoguard validate /path/to/target-repo   # reclassify low-confidence potentials
repoguard report /path/to/target-repo     # regenerate reports
```

## Findings schema

Agents write `findings.json`:

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
      "description": "...",
      "evidence": "...",
      "impact": "...",
      "triggerCondition": "...",
      "reproduction": [],
      "recommendedFix": "..."
    }
  ]
}
```

- `severity` ∈ `critical | high | medium | low | informational`
- `status` ∈ `confirmed | potential | manual-verification | rejected`
- `category` ∈ `bug | security | api-security | authentication | authorization | rate-limiting | dependency | configuration | secrets | test-coverage | other`

Findings are validated with Zod (`src/schemas.ts`) and mirrored as JSON Schema in
[`schemas/finding.schema.json`](schemas/finding.schema.json). Invalid
`findings.json` is ignored with a warning rather than corrupting the report.

## Configuration

Optional `repoguard.config.yaml` in the target repo — see
[`repoguard.config.example.yaml`](repoguard.config.example.yaml) and
[`schemas/config.schema.json`](schemas/config.schema.json).

```yaml
audit:      { bugs, security, apiSecurity, rateLimiting, dependencies, configuration, tests }  # toggles
mode:       { modifyFiles: false, validateFindings: true, minimumConfidence: 75 }
exclude:    [node_modules, dist, build, coverage, vendor, .git]
report:     { formats: [markdown, json, sarif], outputDirectory: repoguard-results }
scanners:   { disabled: [], timeoutMs: 120000 }
```

`--security` and `--api` narrow the audit scope by overriding the `audit.*`
toggles for a single run.

## Repository layout

```
prompts/    reusable review steps (system-audit, bug, api-security, rate-limiting, …)
rules/      declarative YAML rule packs (security/, api/, quality/)
adapters/   per-agent operating instructions (codex, claude-code, cursor, gemini-cli, generic)
scanners/   in-house deterministic scanners (secrets, dependencies, routes, permissions, configuration, security-headers)
schemas/    JSON Schema mirrors of finding / audit / config
templates/  report, finding, and remediation-plan templates
src/        cli, discovery, scanner-runner, evidence-collector, agent-instructions, report-generator, schemas, types, config
```

## Safety guarantees

- Never modifies the repository under audit (read-only; `fix` writes a plan, not
  code, unless `mode.modifyFiles` is enabled).
- Never installs scanners automatically.
- Skips unavailable / disabled / non-applicable scanners without failing the run.
- Its own output directory is excluded from scanning (no self-pollution).
- In-house scanners never emit `confirmed` — they surface leads for validation.
- Instructions forbid claiming a vulnerability confirmed without code evidence
  and require separating Confirmed / Potential / Manual-verification / Rejected.

## Development

```bash
pnpm typecheck    # tsc --noEmit (strict)
pnpm test         # vitest run
pnpm build        # tsup
```

## Limitations

- Static analysis only; the target app is never executed.
- API endpoint discovery and control detection are lexical scans of common Node
  patterns — other frameworks or dynamic routes may be missed, and a control is
  only marked present when visible on the route line (otherwise `?` = verify).
- Access-control, tenant-isolation, and business-logic review depend on the
  driving agent.

## License

MIT
