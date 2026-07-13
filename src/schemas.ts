import { z } from "zod";

/**
 * Zod schemas are the single source of truth for RepoGuard data shapes.
 * All persisted artifacts (discovery.json, evidence.json, findings.json,
 * reports) are validated against these before being written or consumed.
 */

export const SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;

export const FINDING_STATUSES = [
  "confirmed",
  "potential",
  "manual-verification",
  "rejected",
] as const;

export const FINDING_CATEGORIES = [
  "bug",
  "security",
  "api-security",
  "authentication",
  "authorization",
  "rate-limiting",
  "dependency",
  "configuration",
  "secrets",
  "test-coverage",
  "other",
] as const;

export const REPORT_FORMATS = ["markdown", "json", "sarif"] as const;

export const severitySchema = z.enum(SEVERITIES);
export const findingStatusSchema = z.enum(FINDING_STATUSES);
export const findingCategorySchema = z.enum(FINDING_CATEGORIES);
export const reportFormatSchema = z.enum(REPORT_FORMATS);

/** A single audit finding. Mirrors the schema in the product spec. */
export const findingSchema = z.object({
  id: z.string().regex(/^RG-[A-Z]+-\d{3,}$/, "id must look like RG-AUTH-001"),
  title: z.string().min(1),
  severity: severitySchema,
  category: findingCategorySchema,
  status: findingStatusSchema,
  confidence: z.number().int().min(0).max(100),
  file: z.string().nullable().default(null),
  line: z.number().int().positive().nullable().default(null),
  endpoint: z.string().nullable().default(null),
  description: z.string().default(""),
  evidence: z.string().default(""),
  impact: z.string().default(""),
  triggerCondition: z.string().default(""),
  reproduction: z.array(z.string()).default([]),
  recommendedFix: z.string().default(""),
  /** Provenance: "manual", "scanner:secrets", "tool:gitleaks", etc. */
  source: z.string().default("manual"),
});

export const findingsFileSchema = z.object({
  repository: z.string(),
  generatedAt: z.string(),
  findings: z.array(findingSchema),
});

/** A discovered API route with best-effort control detection. */
export const apiEndpointSchema = z.object({
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
});

/**
 * Enriched API inventory row. Boolean controls are `null` when detection is
 * inconclusive — the agent must verify. This encodes the false-positive
 * protection required by the spec (never assert a control it cannot see).
 */
export const apiInventoryEntrySchema = z.object({
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  authRequired: z.boolean().nullable(),
  authorizationChecked: z.boolean().nullable(),
  rateLimited: z.boolean().nullable(),
  inputValidated: z.boolean().nullable(),
  sensitive: z.boolean(),
  notes: z.string().default(""),
});

export const discoverySchema = z.object({
  repository: z.string(),
  generatedAt: z.string(),
  fileCount: z.number().int().nonnegative(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  packageManagers: z.array(z.string()),
  dependencyFiles: z.array(z.string()),
  apiFrameworks: z.array(z.string()),
  testFrameworks: z.array(z.string()),
  databases: z.array(z.string()),
  integrations: z.array(z.string()),
  ciWorkflows: z.array(z.string()),
  infraFiles: z.array(z.string()),
  authFiles: z.array(z.string()),
  configFiles: z.array(z.string()),
  apiEndpoints: z.array(apiEndpointSchema),
});

/** External scanner execution result. */
export const scanStatusSchema = z.enum([
  "completed",
  "skipped-unavailable",
  "skipped-not-applicable",
  "skipped-disabled",
  "error",
  "timeout",
]);

export const scanResultSchema = z.object({
  tool: z.string(),
  available: z.boolean(),
  status: scanStatusSchema,
  command: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number().nonnegative(),
  stdoutFile: z.string().nullable(),
  stderrFile: z.string().nullable(),
  note: z.string().default(""),
});

export const scanReportSchema = z.object({
  repository: z.string(),
  generatedAt: z.string(),
  results: z.array(scanResultSchema),
});

/** Output of a single in-house deterministic scanner. */
export const internalScannerResultSchema = z.object({
  name: z.string(),
  description: z.string(),
  findings: z.array(findingSchema),
  note: z.string().default(""),
});

/** Collected evidence bundle produced before AI review. */
export const evidenceSchema = z.object({
  repository: z.string(),
  generatedAt: z.string(),
  externalScans: scanReportSchema,
  internalScanners: z.array(internalScannerResultSchema),
  apiInventory: z.array(apiInventoryEntrySchema),
  seedFindings: z.array(findingSchema),
});

/** User configuration (repoguard.config.yaml). */
export const configSchema = z.object({
  project: z
    .object({
      name: z.string().default("auto"),
      repository: z.string().default("."),
    })
    .default({ name: "auto", repository: "." }),
  audit: z
    .object({
      bugs: z.boolean().default(true),
      security: z.boolean().default(true),
      apiSecurity: z.boolean().default(true),
      rateLimiting: z.boolean().default(true),
      dependencies: z.boolean().default(true),
      configuration: z.boolean().default(true),
      tests: z.boolean().default(true),
    })
    .default({
      bugs: true,
      security: true,
      apiSecurity: true,
      rateLimiting: true,
      dependencies: true,
      configuration: true,
      tests: true,
    }),
  mode: z
    .object({
      modifyFiles: z.boolean().default(false),
      validateFindings: z.boolean().default(true),
      minimumConfidence: z.number().int().min(0).max(100).default(75),
    })
    .default({ modifyFiles: false, validateFindings: true, minimumConfidence: 75 }),
  exclude: z
    .array(z.string())
    .default([
      "node_modules",
      "dist",
      "action-dist",
      "build",
      "out",
      "coverage",
      "vendor",
      ".git",
      ".claude",
      ".venv",
      "venv",
      "__pycache__",
      ".tox",
      ".next",
      ".nuxt",
      "target",
      ".gradle",
      "Pods",
      "DerivedData",
      ".idea",
      ".cache",
      ".repoguard-tool",
    ]),
  report: z
    .object({
      formats: z.array(reportFormatSchema).default(["markdown", "json", "sarif"]),
      outputDirectory: z.string().default("repoguard-results"),
    })
    .default({ formats: ["markdown", "json", "sarif"], outputDirectory: "repoguard-results" }),
  scanners: z
    .object({
      disabled: z.array(z.string()).default([]),
      timeoutMs: z.number().int().positive().default(120_000),
    })
    .default({ disabled: [], timeoutMs: 120_000 }),
  discovery: z
    .object({
      maxFiles: z.number().int().positive().default(200_000),
      maxEndpointScanFiles: z.number().int().positive().default(5_000),
    })
    .default({ maxFiles: 200_000, maxEndpointScanFiles: 5_000 }),
});

/** Final combined audit report. */
export const auditReportSchema = z.object({
  repository: z.string(),
  generatedAt: z.string(),
  discovery: discoverySchema,
  scans: scanReportSchema,
  apiInventory: z.array(apiInventoryEntrySchema).default([]),
  findings: z.array(findingSchema),
  limitations: z.array(z.string()),
});
