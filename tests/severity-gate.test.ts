import { describe, expect, it } from "vitest";
import {
  findingsAtOrAbove,
  parseFailureThreshold,
  shouldFailAudit,
} from "../src/severity-gate.js";
import { findingSchema } from "../src/schemas.js";

const finding = (
  severity: "critical" | "high" | "medium" | "low" | "informational",
  status: "confirmed" | "potential" | "manual-verification" | "rejected" =
    "confirmed",
) =>
  findingSchema.parse({
    id: `RG-SEC-${severity.length}${status.length}0`,
    title: `${severity} finding`,
    severity,
    category: "security",
    status,
    confidence: 90,
  });

describe("parseFailureThreshold", () => {
  it("accepts every threshold and normalizes case", () => {
    expect(parseFailureThreshold("HIGH")).toBe("high");
    expect(parseFailureThreshold("none")).toBe("none");
  });

  it("rejects unknown thresholds", () => {
    expect(() => parseFailureThreshold("urgent")).toThrow(/critical.*none/);
  });
});

describe("findingsAtOrAbove", () => {
  const findings = [
    finding("critical"),
    finding("high"),
    finding("medium"),
    finding("high", "rejected"),
  ];

  it("returns active findings at or above the threshold", () => {
    expect(
      findingsAtOrAbove(findings, "high").map((item) => item.severity),
    ).toEqual(["critical", "high"]);
  });

  it("never fails for none", () => {
    expect(findingsAtOrAbove(findings, "none")).toEqual([]);
    expect(shouldFailAudit(findings, "none")).toBe(false);
  });
});
