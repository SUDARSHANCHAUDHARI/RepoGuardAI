# Finding Validation

Before anything reaches the report, validate every candidate finding. This step
exists to keep the signal-to-noise ratio high.

For each candidate, assign exactly one status:

- `confirmed` — you traced the vulnerable/buggy code path and can prove it with
  quoted code at `file:line`. Confidence should be high (≥ 80).
- `potential` — the pattern is present and plausible, but you cannot fully
  prove exploitability/impact from the code alone.
- `manual-verification` — requires runtime data, environment, secrets, or
  human judgement you do not have. State exactly what to check.
- `rejected` — a scanner or heuristic flagged it, but the code shows it is a
  false positive. Give a one-line reason.

Rules:

- No `confirmed` without code evidence. If you cannot quote it, it is not
  confirmed.
- Never fabricate file paths, line numbers, endpoints, or advisory IDs.
- Deduplicate: collapse the same root cause reported in multiple places.
- Every finding must fit the RepoGuard finding schema (see below) and validate
  against it.

Finding schema fields: `id`, `title`, `severity`, `category`, `status`,
`confidence`, `file`, `line`, `endpoint`, `description`, `evidence`, `impact`,
`triggerCondition`, `reproduction`, `recommendedFix`.

- `severity` ∈ critical | high | medium | low | informational
- `status` ∈ confirmed | potential | manual-verification | rejected
- `id` format: `RG-<AREA>-<NNN>` e.g. `RG-AUTH-001`.
