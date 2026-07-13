import { describe, expect, it } from "vitest";
import { buildAuditArgs, renderActionSummary } from "../src/action.js";

describe("buildAuditArgs", () => {
  it("builds safe argv without a shell", () => {
    expect(
      buildAuditArgs({
        target: "/tmp/repo",
        scope: "security",
        failOn: "high",
      }),
    ).toEqual(["audit", "/tmp/repo", "--security", "--fail-on", "high"]);
  });

  it("rejects an unsupported scope", () => {
    expect(() =>
      buildAuditArgs({ target: ".", scope: "everything", failOn: "none" }),
    ).toThrow(/full.*security.*api/);
  });
});

describe("renderActionSummary", () => {
  it("contains counts and paths but not finding evidence", () => {
    const summary = renderActionSummary({
      counts: {
        critical: 1,
        high: 2,
        medium: 0,
        low: 0,
        informational: 0,
      },
      reportDirectory: "repoguard-results/reports",
    });
    expect(summary).toContain("Critical | 1");
    expect(summary).toContain("repoguard-results/reports");
    expect(summary).not.toContain("evidence");
  });
});
