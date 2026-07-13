import { describe, expect, it } from "vitest";
import {
  ISSUE_MARKER,
  issueMutation,
  qualifyingFindings,
  renderIssueBody,
} from "../src/github-issue.js";
import { findingSchema } from "../src/schemas.js";

const base = findingSchema.parse({
  id: "RG-SEC-001",
  title: "Unsafe test finding",
  severity: "high",
  category: "security",
  status: "confirmed",
  confidence: 90,
  file: "src/example.ts",
  line: 7,
  evidence: "SECRET_VALUE_MUST_NOT_APPEAR",
  recommendedFix: "Replace the unsafe operation.",
});

describe("security issue rendering", () => {
  it("includes active critical/high findings and excludes rejected findings", () => {
    expect(
      qualifyingFindings([base, { ...base, status: "rejected" }]),
    ).toEqual([base]);
  });

  it("renders identifiers and locations without raw evidence", () => {
    const body = renderIssueBody(
      [base],
      "https://github.com/o/r/actions/runs/1",
    );
    expect(body).toContain(ISSUE_MARKER);
    expect(body).toContain("RG-SEC-001");
    expect(body).toContain("src/example.ts:7");
    expect(body).not.toContain("SECRET_VALUE_MUST_NOT_APPEAR");
  });

  it("selects create, update, close, and no-op lifecycle mutations", () => {
    const existing = { number: 12, body: ISSUE_MARKER };
    expect(issueMutation([base], null).kind).toBe("create");
    expect(issueMutation([base], existing).kind).toBe("update");
    expect(issueMutation([], existing)).toEqual({
      kind: "close",
      issueNumber: 12,
    });
    expect(issueMutation([], null)).toEqual({ kind: "noop" });
  });
});
