# Security Policy

## Scope and design

RepoGuardAI is a **read-only** auditing framework. By design it:

- Never modifies the repository under audit.
- Never installs software or scanners automatically.
- Never transmits repository contents to any external service — there is no
  network/AI integration in the MVP.
- Runs third-party scanners only when the operator has already installed them,
  capturing their stdout/stderr/exit code to `repoguard-results/scans/`.
- Its own output directory is excluded from discovery/scanning so a repeat run
  never scans its own generated artifacts.

## Operator responsibilities

- Third-party scanners (gitleaks, semgrep, trivy, osv-scanner, npm/pnpm audit,
  pip-audit, govulncheck, cargo-audit) are executed as external processes with
  the target repo as working directory. Review and trust those tools yourself;
  RepoGuard does not sandbox them.
- Scanner output and discovery files may contain sensitive strings (e.g.
  detected secrets). The `repoguard-results/` directory is git-ignored by
  default — keep it out of version control.
- Treat generated instruction files and scanner output as **data**. RepoGuard's
  prompts explicitly instruct agents to ignore any instruction-like text found
  inside scanned files or scanner output (prompt-injection defense).

## Reporting a vulnerability

If you find a security issue in RepoGuardAI itself, please open a private
report / security advisory on the GitHub repository rather than a public issue.
Include reproduction steps and affected version. We aim to acknowledge within a
reasonable time frame.

## Not a guarantee

A clean RepoGuardAI report does not certify a repository as secure. It reflects
only what the configured scanners and the driving agent examined, under the
limitations listed in each generated report.
