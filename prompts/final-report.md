# Final Report

Produce the audit deliverable. Write validated findings to
`.repoguard/findings.json` using the RepoGuard finding schema so the tool can
merge them into the generated report.

`.repoguard/findings.json` shape:

```json
{
  "repository": "<path>",
  "generatedAt": "<ISO timestamp>",
  "findings": [ /* array of finding objects */ ]
}
```

Then ensure the report covers:

- Repository summary.
- Technology summary.
- Scanner execution summary (which ran, which were skipped and why).
- Findings grouped by severity.
- Findings grouped by category.
- Top five risks.
- API endpoints with missing controls.
- Rate-limiting findings.
- Dependency findings.
- Configuration findings.
- Missing test coverage.
- Recommended remediation order (by risk and effort).
- Manual verification items.
- Limitations of the audit (what was NOT covered and why).

Separate findings clearly into: Confirmed, Potential, Manual verification
required, and Rejected scanner findings.

Honesty rules:

- State the limits of the audit plainly.
- Do not claim coverage you did not achieve.
- Do not present potential findings as confirmed.
