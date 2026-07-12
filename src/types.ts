import type { z } from "zod";
import type {
  auditReportSchema,
  configSchema,
  discoverySchema,
  findingSchema,
  findingsFileSchema,
  scanReportSchema,
  scanResultSchema,
  apiEndpointSchema,
  apiInventoryEntrySchema,
  evidenceSchema,
  internalScannerResultSchema,
  severitySchema,
  findingStatusSchema,
  findingCategorySchema,
  reportFormatSchema,
} from "./schemas.js";

export type Severity = z.infer<typeof severitySchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type FindingCategory = z.infer<typeof findingCategorySchema>;
export type ReportFormat = z.infer<typeof reportFormatSchema>;

export type Finding = z.infer<typeof findingSchema>;
export type FindingsFile = z.infer<typeof findingsFileSchema>;
export type Discovery = z.infer<typeof discoverySchema>;
export type ApiEndpoint = z.infer<typeof apiEndpointSchema>;
export type ApiInventoryEntry = z.infer<typeof apiInventoryEntrySchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type ScanReport = z.infer<typeof scanReportSchema>;
export type InternalScannerResult = z.infer<typeof internalScannerResultSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type RepoGuardConfig = z.infer<typeof configSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;

export type AgentKind = "codex" | "claude" | "cursor" | "gemini" | "generic";

/** Definition of a single external security/dependency scanner (host binary). */
export interface ScannerDef {
  /** Stable identifier, e.g. "gitleaks". */
  name: string;
  /** Binary invoked on the host. */
  bin: string;
  /** Args used to run the scan (relative to the target repo cwd). */
  args: string[];
  /** Args used to probe availability (should exit fast). */
  versionArgs: string[];
  /** Predicate deciding whether the scan applies to a discovered repo. */
  appliesTo: (discovery: Discovery) => boolean;
  /** Which audit toggle gates this scanner. */
  gate: "security" | "dependencies";
  /** Human description shown in reports. */
  description: string;
}

/** Inputs shared by the in-house deterministic scanners. */
export interface InternalScanContext {
  repoRoot: string;
  files: string[];
  discovery: Discovery;
}
