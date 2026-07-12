import { auditReportSchema, SEVERITIES } from "./schemas.js";
import type {
  ApiInventoryEntry,
  AuditReport,
  Discovery,
  Finding,
  ReportFormat,
  Severity,
  ScanReport,
} from "./types.js";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};

/** Derives honest limitations from what was and wasn't covered. */
export function buildLimitations(
  discovery: Discovery,
  scans: ScanReport,
): string[] {
  const limitations: string[] = [
    "Static analysis only — the application was not executed, so runtime-only issues may be missed.",
    "API endpoint discovery is a lexical scan of common Node patterns; endpoints in other frameworks or built dynamically may be missing.",
    "Access-control, tenant-isolation, and business-logic flaws require human/agent judgement and may not be fully covered.",
  ];

  const unavailable = scans.results
    .filter((r) => r.status === "skipped-unavailable")
    .map((r) => r.tool);
  if (unavailable.length > 0) {
    limitations.push(
      `The following scanners were not installed and did not run: ${unavailable.join(", ")}.`,
    );
  }
  if (discovery.testFrameworks.length === 0) {
    limitations.push(
      "No test framework was detected; test-coverage assessment is limited to structural observation.",
    );
  }
  return limitations;
}

/** Assembles and validates the combined audit report object. */
export function buildAuditReport(
  discovery: Discovery,
  scans: ScanReport,
  findings: Finding[],
  apiInventory: ApiInventoryEntry[] = [],
): AuditReport {
  const report: AuditReport = {
    repository: discovery.repository,
    generatedAt: new Date().toISOString(),
    discovery,
    scans,
    apiInventory,
    findings,
    limitations: buildLimitations(discovery, scans),
  };
  return auditReportSchema.parse(report);
}

function bySeverity(findings: Finding[]): Record<Severity, Finding[]> {
  const out = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    informational: [],
  } as Record<Severity, Finding[]>;
  for (const f of findings) out[f.severity].push(f);
  return out;
}

function findingLine(f: Finding): string {
  const loc = f.file
    ? ` — \`${f.file}${f.line ? `:${f.line}` : ""}\``
    : "";
  const ep = f.endpoint ? ` (\`${f.endpoint}\`)` : "";
  return `- **[${f.severity.toUpperCase()}] ${f.id}** ${f.title}${ep}${loc} · _${f.status}_, confidence ${f.confidence}%`;
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}\n`;
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const lines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [head, sep, ...lines].join("\n");
}

/** Renders the full Markdown audit report. */
export function renderMarkdown(report: AuditReport): string {
  const { discovery, scans, findings } = report;
  const active = findings.filter((f) => f.status !== "rejected");
  const rejected = findings.filter((f) => f.status === "rejected");
  const grouped = bySeverity(active);

  const out: string[] = [];

  out.push(`# RepoGuardAI Audit Report\n`);
  out.push(
    `**Repository:** \`${report.repository}\`  \n**Generated:** ${report.generatedAt}\n`,
  );

  // Repository + technology summary
  out.push(
    section(
      "Repository Summary",
      [
        `- **Files scanned:** ${discovery.fileCount}`,
        `- **Languages:** ${discovery.languages.join(", ") || "none detected"}`,
        `- **Package managers:** ${discovery.packageManagers.join(", ") || "none detected"}`,
        `- **API endpoints discovered:** ${discovery.apiEndpoints.length}`,
        `- **Total findings:** ${findings.length} (${active.length} active, ${rejected.length} rejected)`,
      ].join("\n"),
    ),
  );

  out.push(
    section(
      "Technology Summary",
      [
        `- **Frameworks:** ${discovery.frameworks.join(", ") || "none detected"}`,
        `- **API frameworks:** ${discovery.apiFrameworks.join(", ") || "none detected"}`,
        `- **Databases:** ${discovery.databases.join(", ") || "none detected"}`,
        `- **Integrations:** ${discovery.integrations.join(", ") || "none detected"}`,
        `- **Test frameworks:** ${discovery.testFrameworks.join(", ") || "none detected"}`,
        `- **CI workflows:** ${discovery.ciWorkflows.join(", ") || "none detected"}`,
        `- **Infra files:** ${discovery.infraFiles.join(", ") || "none detected"}`,
        `- **Config files:** ${discovery.configFiles.length}`,
      ].join("\n"),
    ),
  );

  // Scanner execution summary
  const scanRows = scans.results.map((r) => [
    r.tool,
    r.status,
    r.exitCode === null ? "—" : String(r.exitCode),
    `${r.durationMs}ms`,
    r.note ? r.note.replace(/\|/g, "\\|").slice(0, 80) : "",
  ]);
  out.push(
    section(
      "Scanner Execution Summary",
      scanRows.length
        ? table(["Tool", "Status", "Exit", "Duration", "Note"], scanRows)
        : "_No scanners configured._",
    ),
  );

  // Findings by severity
  const sevBody = SEVERITIES.map((sev) => {
    const items = grouped[sev];
    if (items.length === 0) return `### ${sev} (0)\n\n_None._`;
    return `### ${sev} (${items.length})\n\n${items.map(findingLine).join("\n")}`;
  }).join("\n\n");
  out.push(section("Findings by Severity", sevBody));

  // Findings by category
  const byCat = new Map<string, Finding[]>();
  for (const f of active) {
    const arr = byCat.get(f.category) ?? [];
    arr.push(f);
    byCat.set(f.category, arr);
  }
  const catBody = byCat.size
    ? [...byCat.entries()]
        .map(
          ([cat, items]) =>
            `### ${cat} (${items.length})\n\n${items.map(findingLine).join("\n")}`,
        )
        .join("\n\n")
    : "_No findings recorded. Run an agent audit to populate findings._";
  out.push(section("Findings by Category", catBody));

  // Top five risks
  const top = [...active]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.confidence - a.confidence,
    )
    .slice(0, 5);
  out.push(
    section(
      "Top Five Risks",
      top.length
        ? top.map((f, i) => `${i + 1}. ${findingLine(f).slice(2)}`).join("\n")
        : "_No risks recorded yet._",
    ),
  );

  // API endpoints with missing controls: inventory rows lacking a confirmed
  // control, plus any endpoint-scoped findings.
  const gaps = report.apiInventory.filter(
    (e) =>
      e.authRequired !== true ||
      e.authorizationChecked !== true ||
      e.rateLimited !== true ||
      e.inputValidated !== true,
  );
  const invTable = gaps.length
    ? table(
        ["Endpoint", "Auth", "Authz", "Rate limit", "Validation", "Sensitive"],
        gaps.map((e) => [
          `\`${e.method} ${e.path}\``,
          fmtControl(e.authRequired),
          fmtControl(e.authorizationChecked),
          fmtControl(e.rateLimited),
          fmtControl(e.inputValidated),
          e.sensitive ? "yes" : "no",
        ]),
      )
    : report.apiInventory.length
      ? "_All discovered endpoints show a control on their route line (verify in context)._"
      : "_No endpoints discovered._";

  const apiFindings = active.filter(
    (f) =>
      f.endpoint &&
      ["api-security", "authentication", "authorization", "rate-limiting"].includes(
        f.category,
      ),
  );
  const apiFindingsTable = apiFindings.length
    ? `\n\n**Endpoint findings**\n\n${table(
        ["Endpoint", "Issue", "Severity", "Status"],
        apiFindings.map((f) => [`\`${f.endpoint}\``, f.title, f.severity, f.status]),
      )}`
    : "";
  out.push(
    section(
      "API Endpoints With Missing Controls",
      `_"?" means a control was not visible on the route line — verify it._\n\n${invTable}${apiFindingsTable}`,
    ),
  );

  // Category-specific sections
  out.push(
    section("Rate-Limiting Findings", categoryList(active, "rate-limiting")),
  );
  out.push(section("Dependency Findings", categoryList(active, "dependency")));
  out.push(
    section("Configuration Findings", categoryList(active, "configuration")),
  );

  // Missing test coverage
  const testBody =
    discovery.testFrameworks.length === 0
      ? "No test framework detected. Automated test coverage appears to be absent — treat this as a high-priority gap."
      : `Detected test frameworks: ${discovery.testFrameworks.join(", ")}. Coverage completeness was not measured; verify critical paths (auth, payments, data mutations) have tests.`;
  out.push(section("Missing Test Coverage", testBody));

  // Remediation order
  const remediation = top.length
    ? top
        .map(
          (f, i) =>
            `${i + 1}. **${f.id}** (${f.severity}) — ${f.recommendedFix || f.title}`,
        )
        .join("\n")
    : "_Populate findings to generate a remediation order._";
  out.push(section("Recommended Remediation Order", remediation));

  // Manual verification items
  const manual = findings.filter((f) => f.status === "manual-verification");
  out.push(
    section(
      "Manual Verification Items",
      manual.length
        ? manual.map(findingLine).join("\n")
        : "_None flagged._",
    ),
  );

  // Rejected scanner findings
  out.push(
    section(
      "Rejected Scanner Findings",
      rejected.length
        ? rejected
            .map((f) => `- **${f.id}** ${f.title} — ${f.description || "rejected"}`)
            .join("\n")
        : "_None._",
    ),
  );

  // Limitations
  out.push(
    section(
      "Limitations of This Audit",
      report.limitations.map((l) => `- ${l}`).join("\n"),
    ),
  );

  out.push(
    `\n---\n\n_Generated by RepoGuardAI. Findings require human review before action._\n`,
  );

  return out.join("\n");
}

function categoryList(findings: Finding[], category: string): string {
  const items = findings.filter((f) => f.category === category);
  return items.length ? items.map(findingLine).join("\n") : "_None recorded._";
}

function fmtControl(v: boolean | null): string {
  return v === null ? "?" : v ? "yes" : "no";
}

const SARIF_LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "warning",
  informational: "note",
};

/**
 * Renders a SARIF 2.1.0 document. Rejected findings are excluded. Findings
 * without a file are attached to the repository root so the doc stays valid.
 */
export function renderSarif(report: AuditReport): object {
  const active = report.findings.filter((f) => f.status !== "rejected");
  const rules = active.map((f) => ({
    id: f.id,
    name: f.category,
    shortDescription: { text: f.title },
    fullDescription: { text: f.description || f.title },
    defaultConfiguration: { level: SARIF_LEVEL[f.severity] },
    properties: { category: f.category, severity: f.severity },
  }));

  const results = active.map((f) => ({
    ruleId: f.id,
    level: SARIF_LEVEL[f.severity],
    message: {
      text: [f.title, f.impact && `Impact: ${f.impact}`, f.recommendedFix && `Fix: ${f.recommendedFix}`]
        .filter(Boolean)
        .join(" "),
    },
    properties: {
      status: f.status,
      confidence: f.confidence,
      endpoint: f.endpoint ?? undefined,
      source: f.source,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.file ?? "." },
          ...(f.line ? { region: { startLine: f.line } } : {}),
        },
      },
    ],
  }));

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "RepoGuardAI",
            informationUri: "https://github.com/SUDARSHANCHAUDHARI/RepoGuardAI",
            version: "0.1.0",
            rules,
          },
        },
        results,
      },
    ],
  };
}

/** Renders the report in a single requested format as a string. */
export function renderFormat(report: AuditReport, format: ReportFormat): string {
  switch (format) {
    case "markdown":
      return renderMarkdown(report);
    case "json":
      return `${JSON.stringify(report, null, 2)}\n`;
    case "sarif":
      return `${JSON.stringify(renderSarif(report), null, 2)}\n`;
  }
}
