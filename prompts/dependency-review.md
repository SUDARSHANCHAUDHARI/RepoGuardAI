# Dependency Review

Assess third-party dependency risk.

Sources:

- Scanner output in `.repoguard/scans/` (osv-scanner, npm/pnpm audit,
  pip-audit, govulncheck, cargo-audit, trivy).
- Dependency manifests and lockfiles listed in discovery.

Check:

- Known vulnerable versions (CVE/GHSA) — cross-reference scanner hits with the
  actual installed version in the lockfile.
- Direct vs transitive: is the app actually reachable to the vulnerable code
  path? Mark unreachable ones `manual-verification`, not `confirmed`.
- Unmaintained / abandoned packages.
- Suspicious or typosquatted package names.
- Duplicate/conflicting versions.
- Overly permissive version ranges pulling unexpected majors.
- License risks if in scope.

For each vulnerable dependency report: package, installed version, advisory ID,
severity, whether a fixed version exists, and the upgrade path. Do not invent
advisory IDs — cite the scanner output file that reported it.
