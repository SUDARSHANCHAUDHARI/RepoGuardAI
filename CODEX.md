# CODEX.md

Project context for OpenAI Codex / coding agents working on RepoGuardAI.

## Summary

Tool-independent repository auditing framework. Deterministic scaffolding
(discovery, scanning, prompt generation, reporting) lives here; the reasoning is
delegated to whichever agent runs the generated instructions. Provider-neutral.

## Working rules

- TypeScript strict. Validate all persisted data with Zod (`src/schemas.ts`).
- Robust error handling around filesystem and subprocess calls.
- Never modify a repository under audit; never auto-install scanners.
- Never fabricate paths, lines, endpoints, or scanner output.
- Modular by design: add scanners in `SCANNERS` (`src/scanner-runner.ts`), add
  external scanners in `SCANNERS` (`src/scanner-runner.ts`), in-house scanners in
  `INTERNAL_SCANNERS` (`scanners/index.ts`), and agents in `ADAPTER_FILE`
  (`src/agent-instructions.ts`).

## Build & verify

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Auditing another repo with Codex

Follow `repoguard-results/instructions/codex-instructions.md`. Read-only review;
open real files before asserting anything; cite `file:line`; write findings to
`repoguard-results/findings.json` in the finding schema.
