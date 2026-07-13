import { SEVERITIES } from "./schemas.js";
import type { Finding, Severity } from "./types.js";

export const FAILURE_THRESHOLDS = [...SEVERITIES, "none"] as const;
export type FailureThreshold = (typeof FAILURE_THRESHOLDS)[number];

const severityRank = new Map<Severity, number>(
  SEVERITIES.map((severity, index) => [severity, index]),
);

export function parseFailureThreshold(value: string): FailureThreshold {
  const normalized = value.toLowerCase();
  if (!FAILURE_THRESHOLDS.includes(normalized as FailureThreshold)) {
    throw new Error(
      `Unknown failure threshold "${value}". Use: ${FAILURE_THRESHOLDS.join(", ")}.`,
    );
  }
  return normalized as FailureThreshold;
}

export function findingsAtOrAbove(
  findings: Finding[],
  threshold: FailureThreshold,
): Finding[] {
  if (threshold === "none") return [];
  const thresholdRank =
    severityRank.get(threshold) ?? Number.NEGATIVE_INFINITY;
  return findings.filter(
    (finding) =>
      finding.status !== "rejected" &&
      (severityRank.get(finding.severity) ?? Number.POSITIVE_INFINITY) <=
        thresholdRank,
  );
}

export function shouldFailAudit(
  findings: Finding[],
  threshold: FailureThreshold,
): boolean {
  return findingsAtOrAbove(findings, threshold).length > 0;
}
