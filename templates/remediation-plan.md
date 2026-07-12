# Remediation Plan — {{id}}

**Finding:** {{title}}
**Severity:** {{severity}} · **Category:** {{category}} · **Status:** {{status}}
**Location:** `{{file}}:{{line}}` {{endpoint}}

## 1. Confirm the issue
- Re-read `{{file}}` around line {{line}} and confirm the trigger condition:
  {{triggerCondition}}
- Verify no existing control already mitigates it.

## 2. Proposed fix
{{recommendedFix}}

## 3. Implementation steps
- [ ] Apply the change in `{{file}}`.
- [ ] Add/adjust input validation or access checks as needed.
- [ ] Add a regression test that fails before and passes after the fix.
- [ ] Re-run the relevant scanners and `repoguard report`.

## 4. Verification
- [ ] The trigger condition no longer reproduces the issue.
- [ ] No regression in related endpoints/flows.
- [ ] Finding status can move to `rejected` (fixed) with evidence.

## 5. Notes
> RepoGuard does not modify files unless `mode.modifyFiles` is enabled and the
> operator approves. This plan is a proposal for a human or agent to apply.
