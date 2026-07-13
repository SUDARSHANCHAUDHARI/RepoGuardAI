# Daily Security Automation Design

**Date:** 2026-07-13
**Status:** Design approved; written specification awaiting review
**Repository:** `SUDARSHANCHAUDHARI/RepoGuardAI`

## Objective

Turn RepoGuardAI into a reusable, free GitHub security automation layer that:

- scans repositories every day and on relevant pull requests;
- identifies dependency, code, secret, and configuration risks;
- creates reviewable dependency-update pull requests;
- reports code-level findings without applying unsafe automatic fixes;
- works for public repositories and degrades cleanly on private repositories
  that do not have GitHub Advanced Security features.

The first installation will dogfood the automation in RepoGuardAI. The Website
repository will be the first external consumer after RepoGuardAI's workflow has
been validated.

## Current State

RepoGuardAI already provides the core deterministic audit pipeline:

- repository discovery;
- internal security and dependency-hygiene scanners;
- optional external scanners including Semgrep, Gitleaks, Trivy, OSV Scanner,
  and package-manager audits;
- Markdown, JSON, and SARIF reports;
- remediation-plan generation that does not edit target code by default;
- a separate dependency sweep that performs in-range `pnpm update` and
  `pnpm dedupe` operations without committing changes.

The missing layer is GitHub orchestration. There is no scheduled security
workflow, Dependabot configuration, packaged GitHub Action, severity exit gate,
deduplicated issue reporting, or consumer workflow documentation.

## Selected Approach

Package RepoGuardAI as a GitHub Action and expose its complete scan through a
reusable workflow. A repository that consumes RepoGuardAI adds a small caller
workflow that controls its own schedule, events, permissions, and optional
SARIF upload.

This approach was selected over copying a large workflow into every repository
and over building a hosted GitHub App. It centralizes scanner behavior without
requiring a hosted service, broad installation token, database, or paid
infrastructure.

## Architecture

### 1. RepoGuardAI GitHub Action

A repository-root `action.yml` will expose RepoGuardAI as a reusable action.
The action will:

1. accept the target path and audit scope;
2. accept a minimum failure severity;
3. run the packaged RepoGuardAI CLI against the checked-out repository;
4. write reports to the configured output directory;
5. append a concise result to the GitHub Actions job summary;
6. return a non-zero status only after reports have been generated.

The action will not install arbitrary scanners, modify the target repository,
commit changes, push branches, or merge pull requests.

### 2. Severity Exit Gate

The CLI will gain a `--fail-on <severity>` option for audit execution. Accepted
values will be `critical`, `high`, `medium`, `low`, `informational`, and `none`.

The gate will evaluate active findings after report generation. A run fails
when at least one active finding meets or exceeds the configured threshold.
Rejected findings do not fail a run. Scanner execution errors remain distinct
from a clean result and must not be converted into "no findings."

The default CLI behavior remains backward compatible: without `--fail-on`, an
audit reports findings without failing because of severity.

### 3. Reusable Security Workflow

A `workflow_call` workflow will orchestrate the free scanners and RepoGuardAI.
It will expose inputs for:

- target path;
- package-manager working directory;
- minimum failure severity;
- SARIF upload enablement;
- issue reporting enablement;
- optional scanner selection.

The workflow will run these stages:

1. checkout with minimal permissions;
2. set up Node and pnpm with a frozen lockfile;
3. build or invoke RepoGuardAI;
4. run package-manager audit and OSV Scanner;
5. run Semgrep and Gitleaks;
6. run RepoGuardAI and generate Markdown, JSON, and SARIF reports;
7. upload reports as workflow artifacts even when the severity gate fails;
8. optionally upload SARIF when the consumer supports GitHub code scanning;
9. publish a concise job summary;
10. optionally create or update a deduplicated security issue on trusted runs.

Scanner tools and third-party Actions will use pinned versions. GitHub Actions
references will be pinned to immutable commit SHAs, with readable comments for
the corresponding release versions.

### 4. Repository Caller Workflow

RepoGuardAI will include its own caller workflow with these triggers:

- daily schedule;
- manual `workflow_dispatch`;
- pushes to `main` that change security-relevant source or dependency files;
- pull requests that change security-relevant source or dependency files.

The caller owns permissions. Pull-request scans use read-only permissions and
never create issues. Scheduled and default-branch scans may receive narrowly
scoped `issues: write` and `security-events: write` permissions for reporting.

The scheduled workflow will use UTC cron syntax and document the corresponding
Bangkok execution time. Exact execution time is not guaranteed by GitHub and
must not be treated as a service-level promise.

### 5. Dependabot

RepoGuardAI will add `.github/dependabot.yml` with daily update checks for:

- the root npm/pnpm dependency graph;
- GitHub Actions dependencies.

Dependabot pull requests will be grouped conservatively where compatible.
Security updates remain reviewable pull requests. Automatic merge is excluded
from the initial implementation.

Each Dependabot pull request must pass typecheck, tests, build, package audit,
and the security workflow before it is eligible for manual merge.

### 6. Deduplicated Issue Reporting

Issue reporting will operate only for scheduled or trusted default-branch runs.
One repository issue will represent the current critical/high security state.
The issue will contain a stable hidden marker so subsequent runs update the
same issue instead of opening duplicates.

Behavior:

- open the issue when qualifying active findings exist and no marked issue is
  open;
- update the marked issue when the finding summary changes;
- close the marked issue when no qualifying findings remain;
- never include raw secret values, complete scanner logs, or untrusted code
  content in issue commands;
- link to the workflow run and uploaded report for full evidence.

The workflow will not automatically create one issue per finding in the first
version. That would create unnecessary noise and complicate lifecycle handling.

## Public and Private Repository Behavior

### Public repositories

Public repositories can use RepoGuardAI, open-source scanners, Dependabot, and
GitHub's public-repository code-scanning features. SARIF upload may be enabled
by the caller.

### Private repositories on free plans

Private repositories can still run RepoGuardAI, package-manager audits, OSV
Scanner, Semgrep, and Gitleaks using their available GitHub Actions minutes.
They report through workflow summaries, artifacts, and deduplicated issues.

SARIF upload is an explicit caller option and defaults to disabled for reusable
consumers so a private repository does not fail because native code scanning is
unavailable. Native secret scanning is not assumed; Gitleaks provides the free
workflow-level substitute.

## Security Model

### Permissions

- The scan job receives `contents: read` only.
- SARIF upload receives `security-events: write` only when explicitly enabled.
- Issue reporting receives `issues: write` only in its isolated trusted job.
- No workflow receives `contents: write` for routine scanning.
- No workflow receives a personal access token.

### Untrusted pull requests

- Use `pull_request`, not `pull_request_target`, for code scanning.
- Do not expose repository secrets to pull-request code.
- Do not create issues, comments, commits, or branches from an untrusted scan.
- Treat generated report text as data, not shell commands.

### Dependency remediation

- Dependabot is the only automated dependency-change producer in the first
  version.
- RepoGuardAI reports upgrade guidance but does not execute `audit fix`, apply
  major upgrades, or rewrite manifests during a scan.
- No dependency update is automatically merged.

### Secret handling

- Secret scanner output is stored as a restricted workflow artifact according
  to GitHub's repository access model.
- Job summaries and issues contain paths, rule identifiers, and remediation
  guidance, never detected secret values.
- The workflow does not send repository contents or findings to an AI service.

## Failure Handling

The workflow will distinguish these outcomes:

- **Clean:** scanners completed and no finding met the threshold.
- **Findings:** scanners completed and one or more findings met the threshold.
- **Partial:** an optional scanner was unavailable or failed, while other
  results were preserved.
- **Infrastructure failure:** checkout, dependency installation, build, or core
  RepoGuard execution failed.

Reports and logs upload under `if: always()` where safe, so a failed gate does
not erase the evidence needed to diagnose the run. Optional scanner failures
will be visible and configurable; core RepoGuard failures will fail the job.

## Testing Strategy

### CLI tests

- validate accepted and rejected `--fail-on` values;
- verify severity ordering;
- verify rejected findings do not trigger failure;
- verify reports are written before the non-zero exit;
- verify default behavior remains non-failing.

### Action tests

- validate `action.yml` structure;
- run the action against RepoGuardAI in a local-style CI fixture;
- confirm expected output paths and job-summary generation;
- confirm no target source files are modified.

### Workflow tests

- lint workflow YAML and shell fragments;
- verify third-party Actions are SHA-pinned;
- verify explicit minimal permissions;
- verify artifact upload uses `if: always()`;
- verify issue reporting cannot run for pull-request events;
- verify SARIF upload can be disabled.

### Repository verification

Before completion:

1. run typecheck;
2. run the complete test suite;
3. build the package;
4. run `pnpm audit` and confirm critical/high findings are resolved or
   explicitly documented;
5. run RepoGuardAI against itself;
6. validate action and workflow syntax;
7. trigger the caller workflow manually;
8. inspect its summary, artifacts, SARIF upload, and issue lifecycle;
9. confirm the git diff contains no generated reports or secrets.

## Documentation

The README will document:

- using RepoGuardAI as a GitHub Action;
- calling the reusable workflow from public and private repositories;
- enabling or disabling SARIF and issue reporting;
- expected permissions;
- Dependabot's role versus RepoGuardAI's role;
- limitations of automatic remediation;
- a Website-specific installation example covering the root and each worker
  package directory.

## Rollout

### Phase 1: RepoGuardAI dogfooding

- resolve RepoGuardAI's current vulnerable test/build toolchain;
- add the exit gate, action, reusable workflow, caller, and Dependabot;
- manually run and inspect the complete workflow;
- keep all dependency merges manual.

### Phase 2: Website pilot

- add the small caller workflow to Website;
- add Dependabot coverage for the root and four worker directories;
- keep SARIF disabled while Website remains private without code scanning;
- verify issue deduplication and scanner runtime;
- address Website findings through separate reviewed changes.

### Phase 3: Portfolio adoption

- reuse the caller pattern only after the first two repositories are stable;
- tune schedules to avoid unnecessary private-repository Actions usage;
- add ecosystem-specific package directories per repository;
- avoid a central token or hosted control plane.

## Non-Goals

The initial implementation will not:

- automatically merge dependency pull requests;
- automatically rewrite application code for security findings;
- create or host a GitHub App;
- store findings in an external database;
- require a paid scanner or AI API;
- enable security settings across every repository automatically;
- claim that a clean static scan certifies a repository as secure.

## Success Criteria

The design is successfully implemented when:

1. RepoGuardAI runs a scheduled daily security workflow on GitHub.
2. The workflow produces useful reports even when a severity gate fails.
3. Dependabot opens reviewable dependency and Actions update pull requests.
4. Critical/high findings create or update one deduplicated issue on trusted
   runs and close it after remediation.
5. Pull-request scans are read-only and receive no secrets.
6. Public consumers can enable SARIF upload; private free consumers can disable
   it without losing scan coverage.
7. RepoGuardAI has no unresolved critical or high package audit findings at the
   time the feature is completed.
8. Typecheck, tests, build, self-audit, workflow validation, and the manual
   GitHub workflow smoke test all pass.
9. Documentation is sufficient to install the workflow in Website without
   copying RepoGuardAI's internal implementation.
