import { describe, it, expect } from "vitest";
import {
  buildAuditReport,
  renderMarkdown,
  renderSarif,
  buildLimitations,
} from "../src/report-generator.js";
import { generateInstructions } from "../src/agent-instructions.js";
import { findingSchema, discoverySchema } from "../src/schemas.js";
import type { Discovery, Finding, ScanReport } from "../src/types.js";

const discovery: Discovery = discoverySchema.parse({
  repository: "/tmp/target",
  generatedAt: new Date().toISOString(),
  fileCount: 12,
  languages: ["TypeScript"],
  frameworks: ["Express"],
  packageManagers: ["pnpm"],
  dependencyFiles: ["package.json"],
  apiFrameworks: ["Express"],
  testFrameworks: [],
  databases: ["PostgreSQL"],
  integrations: ["Stripe"],
  ciWorkflows: [],
  infraFiles: [],
  authFiles: ["src/auth.ts"],
  configFiles: [".env"],
  apiEndpoints: [
    { method: "POST", path: "/api/login", file: "src/auth.ts", line: 42 },
  ],
});

const scans: ScanReport = {
  repository: "/tmp/target",
  generatedAt: new Date().toISOString(),
  results: [
    {
      tool: "gitleaks",
      available: true,
      status: "completed",
      command: "gitleaks detect",
      exitCode: 0,
      durationMs: 120,
      stdoutFile: ".repoguard/scans/gitleaks.stdout.txt",
      stderrFile: ".repoguard/scans/gitleaks.stderr.txt",
      note: "",
    },
    {
      tool: "semgrep",
      available: false,
      status: "skipped-unavailable",
      command: "semgrep scan",
      exitCode: null,
      durationMs: 0,
      stdoutFile: null,
      stderrFile: null,
      note: "not installed",
    },
  ],
};

const findings: Finding[] = [
  findingSchema.parse({
    id: "RG-AUTH-001",
    title: "Login endpoint has no rate limiting",
    severity: "high",
    category: "rate-limiting",
    status: "confirmed",
    confidence: 90,
    file: "src/auth.ts",
    line: 42,
    endpoint: "POST /api/login",
    recommendedFix: "Add an IP+user rate limiter.",
  }),
  findingSchema.parse({
    id: "RG-DEP-001",
    title: "Vulnerable lodash version",
    severity: "medium",
    category: "dependency",
    status: "potential",
    confidence: 60,
  }),
  findingSchema.parse({
    id: "RG-SEC-009",
    title: "Semgrep false positive",
    severity: "low",
    category: "security",
    status: "rejected",
    confidence: 10,
    description: "Not reachable from user input.",
  }),
];

describe("buildAuditReport", () => {
  it("assembles and validates a report", () => {
    const report = buildAuditReport(discovery, scans, findings);
    expect(report.findings).toHaveLength(3);
    expect(report.limitations.length).toBeGreaterThan(0);
  });
});

describe("buildLimitations", () => {
  it("notes unavailable scanners and missing tests", () => {
    const lims = buildLimitations(discovery, scans);
    expect(lims.join("\n")).toContain("semgrep");
    expect(lims.join("\n").toLowerCase()).toContain("test");
  });
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(buildAuditReport(discovery, scans, findings));

  it("includes all required sections", () => {
    for (const heading of [
      "Repository Summary",
      "Technology Summary",
      "Scanner Execution Summary",
      "Findings by Severity",
      "Findings by Category",
      "Top Five Risks",
      "API Endpoints With Missing Controls",
      "Rate-Limiting Findings",
      "Dependency Findings",
      "Configuration Findings",
      "Missing Test Coverage",
      "Recommended Remediation Order",
      "Manual Verification Items",
      "Rejected Scanner Findings",
      "Limitations of This Audit",
    ]) {
      expect(md).toContain(heading);
    }
  });

  it("separates active from rejected findings", () => {
    expect(md).toContain("RG-AUTH-001");
    expect(md).toContain("RG-SEC-009"); // shown under rejected
    // rejected finding must not appear in the top-risk numbering
    const topSection = md.slice(md.indexOf("Top Five Risks"));
    expect(topSection.slice(0, 300)).not.toContain("RG-SEC-009");
  });
});

describe("renderSarif", () => {
  const sarif = renderSarif(buildAuditReport(discovery, scans, findings)) as {
    version: string;
    runs: {
      tool: { driver: { name: string; rules: { id: string }[] } };
      results: { ruleId: string; level: string }[];
    }[];
  };

  it("emits SARIF 2.1.0 with active findings and excludes rejected", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]!.tool.driver.name).toBe("RepoGuardAI");
    const ruleIds = sarif.runs[0]!.results.map((r) => r.ruleId);
    expect(ruleIds).toContain("RG-AUTH-001");
    expect(ruleIds).not.toContain("RG-SEC-009"); // rejected excluded
  });

  it("maps severity to SARIF level", () => {
    const auth = sarif.runs[0]!.results.find((r) => r.ruleId === "RG-AUTH-001");
    expect(auth!.level).toBe("error"); // high -> error
  });
});

describe("generateInstructions", () => {
  it("produces agent-specific instructions with context, rules, and playbook", () => {
    const md = generateInstructions("cursor", discovery);
    expect(md).toContain("Cursor");
    expect(md).toContain("Repository Context");
    expect(md).toContain("Rule Packs");
    expect(md).toContain("Review Playbook");
    expect(md).toContain("API Security Review");
    expect(md).toContain("Rate-Limiting Review");
    expect(md).toContain("Databases");
  });

  it("supports all five agents", () => {
    for (const agent of ["codex", "claude", "cursor", "gemini", "generic"] as const) {
      expect(generateInstructions(agent, discovery)).toContain("Audit Instructions");
    }
  });

  it("handles missing discovery gracefully", () => {
    const md = generateInstructions("codex", null);
    expect(md).toContain("No discovery data found");
  });
});
