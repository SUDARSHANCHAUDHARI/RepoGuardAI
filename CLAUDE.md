# CLAUDE.md

Project context for Claude Code working on RepoGuardAI.

## What this is

A tool-independent repository auditing framework. RepoGuard does deterministic
work (discovery, scanning, prompt generation, report assembly); a coding agent
does the reasoning. No AI provider is baked in.

## Rules

- TypeScript strict mode. No `any`. Prefer narrowing `unknown`.
- Validate every persisted artifact with the Zod schemas in `src/schemas.ts`.
- Add error handling for file access, subprocess execution, malformed config,
  and invalid scanner output — never assume the happy path.
- Do not modify the repository being audited. Do not auto-install scanners.
- Do not fabricate file paths, line numbers, endpoints, or scanner results.
- Keep changes surgical and the design modular (pluggable scanners + agents).

## Commands

```bash
pnpm dev -- <command>   # run CLI via tsx
pnpm typecheck
pnpm test
pnpm build
```

## Where things live

- CLI wiring: `src/cli.ts`
- Repo discovery + API route scan: `src/discovery.ts`
- External scanner registry + runner: `src/scanner-runner.ts`
- In-house deterministic scanners: `scanners/` (+ `INTERNAL_SCANNERS`)
- Evidence fusion (external + in-house + API inventory): `src/evidence-collector.ts`
- Prompt/rule assembly per agent: `src/agent-instructions.ts` (+ `prompts/`, `rules/`, `adapters/`)
- Report rendering (md/json/sarif): `src/report-generator.ts`
- Schemas/types: `src/schemas.ts`, `src/types.ts` (+ `schemas/*.json`)
- Tests: `tests/`

## When auditing another repo with Claude Code

Follow `repoguard-results/instructions/claude-instructions.md`. Read-only. Cite
`file:line`. Write findings to `repoguard-results/findings.json`.
