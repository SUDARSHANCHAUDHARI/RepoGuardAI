# GitHub Security Automation

RepoGuardAI provides a reusable GitHub Actions workflow for daily and
pull-request security checks. It combines RepoGuardAI with Semgrep CE, OSV
Scanner, Gitleaks, package-manager auditing, optional SARIF upload, and a
deduplicated critical/high findings issue.

The workflow is free to use. Public repositories can upload SARIF to GitHub
code scanning. Private repositories without GitHub code scanning can retain the
same scanners and use workflow summaries, artifacts, and issues instead.

## Trust model

The reusable workflow separates permissions by job:

- target repository code runs only in the scan job with `contents: read`;
- SARIF upload runs in a separate job with `security-events: write`;
- issue synchronization runs in a separate trusted job with `issues: write`;
- pull-request runs never create or update issues;
- no scan receives a personal access token or automatically commits, pushes,
  fixes, or merges code.

Reports are uploaded for 14 days before the final severity result is applied.
Issue summaries include finding IDs, titles, severities, and locations, but not
raw evidence or detected secret values.

## Public repository caller

Create `.github/workflows/security.yml`:

```yaml
name: Security

on:
  schedule:
    - cron: "17 20 * * *"
  workflow_dispatch:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  issues: write
  security-events: write

jobs:
  security:
    uses: SUDARSHANCHAUDHARI/RepoGuardAI/.github/workflows/reusable-security.yml@v1
    with:
      repoguard_ref: v1
      scope: security
      fail_on: high
      upload_sarif: true
      report_issues: ${{ github.event_name != 'pull_request' }}
```

Public repositories can review RepoGuardAI results in the workflow artifact and
GitHub's code-scanning interface.

## Private repository on a free plan

Use the same workflow with SARIF disabled:

```yaml
name: Security

on:
  schedule:
    - cron: "17 20 * * *"
  workflow_dispatch:
  pull_request:
    branches: [main]

permissions:
  contents: read
  issues: write

jobs:
  security:
    uses: SUDARSHANCHAUDHARI/RepoGuardAI/.github/workflows/reusable-security.yml@v1
    with:
      repoguard_ref: v1
      scope: security
      fail_on: high
      upload_sarif: false
      report_issues: true
```

This retains RepoGuardAI, Semgrep, OSV, Gitleaks, dependency audits, job
summaries, artifacts, and the synchronized issue. It does not depend on paid
private-repository code or secret scanning. Private repositories consume their
available GitHub Actions minutes.

## Version pinning

`@v1` follows compatible RepoGuardAI v1 security fixes. For maximum
immutability, replace both `@v1` and `repoguard_ref: v1` with the same full
40-character release commit SHA. Never point the workflow and tooling checkout
at different RepoGuardAI revisions.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `repoguard_ref` | `v1` | RepoGuardAI tag or commit checked out as tooling. |
| `scope` | `security` | `full`, `security`, or `api`. |
| `fail_on` | `high` | Lowest active severity that fails after reports exist. |
| `upload_sarif` | `false` | Enables the isolated code-scanning upload job. |
| `report_issues` | `false` | Enables trusted critical/high issue synchronization. |

Use `fail_on: none` for report-only adoption. Rejected findings never trigger
the severity gate.

## Dependabot

RepoGuardAI does not rewrite dependency manifests during a scan. Dependabot is
the automated change producer: it opens reviewable pull requests which must
pass the repository's tests and security checks. Automatic merging is not
configured.

## Website pilot

`SUDARSHANCHAUDHARI/Website` is private, so its caller should use
`upload_sarif: false`. Its `.github/dependabot.yml` must cover every independent
pnpm lockfile:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: &daily
      interval: "daily"
      time: "03:17"
      timezone: "Asia/Bangkok"

  - package-ecosystem: "npm"
    directory: "/workers/contact"
    schedule: *daily

  - package-ecosystem: "npm"
    directory: "/workers/github-stats"
    schedule: *daily

  - package-ecosystem: "npm"
    directory: "/workers/newsletter"
    schedule: *daily

  - package-ecosystem: "npm"
    directory: "/workers/post-views"
    schedule: *daily

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: *daily
```

Install the Website caller only after the RepoGuardAI v1 workflow has completed
successfully against RepoGuardAI itself. Website findings and dependency
updates should be addressed in separate reviewed pull requests.

## Troubleshooting

### SARIF upload fails with code scanning unavailable

Set `upload_sarif: false`. The Markdown and JSON reports remain available in
the workflow artifact.

### An optional scanner fails

Open the scan log and artifact. RepoGuardAI records unavailable scanners as a
coverage limitation rather than describing the run as clean. OSV or Gitleaks
failures are also reflected by the final workflow result.

### The security issue contains no raw evidence

This is intentional. The issue is a redacted state summary. Use the linked
workflow run and access-controlled artifact for complete evidence.

### A dependency update is not merged

This is intentional. Dependabot opens PRs, but RepoGuardAI does not enable
automatic merge. Review the change and its CI/security results before merging.
