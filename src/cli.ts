import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { discover } from "./discovery.js";
import { collectEvidence } from "./evidence-collector.js";
import { generateInstructions } from "./agent-instructions.js";
import { buildAuditReport, renderFormat } from "./report-generator.js";
import {
  findingsAtOrAbove,
  parseFailureThreshold,
} from "./severity-gate.js";
import {
  discoverySchema,
  evidenceSchema,
  findingsFileSchema,
} from "./schemas.js";
import type {
  AgentKind,
  ApiInventoryEntry,
  Discovery,
  Evidence,
  Finding,
  RepoGuardConfig,
} from "./types.js";

const AGENTS: AgentKind[] = ["codex", "claude", "cursor", "gemini", "generic"];

type AuditOptions = {
  security?: boolean;
  api?: boolean;
  failOn?: string;
};

const REPORT_FILE: Record<string, string> = {
  markdown: "audit-report.md",
  json: "audit-report.json",
  sarif: "audit-report.sarif",
};

function resolveRepo(input: string): string {
  return isAbsolute(input) ? input : resolve(process.cwd(), input);
}

function outDir(repo: string, config: RepoGuardConfig): string {
  return join(repo, config.report.outputDirectory);
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Applies --security / --api scope flags on top of config.audit. */
function applyScope(
  config: RepoGuardConfig,
  opts: { security?: boolean; api?: boolean },
): RepoGuardConfig {
  if (!opts.security && !opts.api) return config;
  const audit = {
    bugs: false,
    security: false,
    apiSecurity: false,
    rateLimiting: false,
    dependencies: false,
    configuration: false,
    tests: false,
  };
  if (opts.security) {
    audit.security = true;
    audit.dependencies = true;
    audit.configuration = true;
  }
  if (opts.api) {
    audit.apiSecurity = true;
    audit.rateLimiting = true;
  }
  return { ...config, audit };
}

function loadOrRunDiscovery(repo: string, config: RepoGuardConfig): Discovery {
  const path = join(outDir(repo, config), "discovery.json");
  if (existsSync(path)) {
    const parsed = discoverySchema.safeParse(readJsonFile(path));
    if (parsed.success) return parsed.data;
    console.warn("⚠ Existing discovery.json is invalid; regenerating.");
  }
  const discovery = discover(repo, config);
  writeJson(path, discovery);
  return discovery;
}

function loadEvidence(repo: string, config: RepoGuardConfig): Evidence | null {
  const path = join(outDir(repo, config), "evidence.json");
  if (!existsSync(path)) return null;
  const parsed = evidenceSchema.safeParse(readJsonFile(path));
  return parsed.success ? parsed.data : null;
}

/** Loads agent-authored findings; falls back to evidence seed findings. */
function loadFindings(repo: string, config: RepoGuardConfig): Finding[] {
  const path = join(outDir(repo, config), "findings.json");
  if (existsSync(path)) {
    const parsed = findingsFileSchema.safeParse(readJsonFile(path));
    if (parsed.success) return parsed.data.findings;
    console.warn(`⚠ ${path} failed schema validation; ignoring.`);
  }
  return loadEvidence(repo, config)?.seedFindings ?? [];
}

function writeFindings(
  repo: string,
  config: RepoGuardConfig,
  findings: Finding[],
): void {
  writeJson(join(outDir(repo, config), "findings.json"), {
    repository: repo,
    generatedAt: new Date().toISOString(),
    findings,
  });
}

function writeReports(
  repo: string,
  config: RepoGuardConfig,
  discovery: Discovery,
  scans: Evidence["externalScans"],
  findings: Finding[],
  apiInventory: ApiInventoryEntry[],
): void {
  const report = buildAuditReport(discovery, scans, findings, apiInventory);
  const dir = join(outDir(repo, config), "reports");
  mkdirSync(dir, { recursive: true });
  for (const fmt of config.report.formats) {
    const file = join(dir, REPORT_FILE[fmt] ?? `audit-report.${fmt}`);
    writeFileSync(file, renderFormat(report, fmt), "utf8");
    console.log(`✔ Report written: ${file}`);
  }
  console.log(
    `  Findings: ${findings.length} · Scanners completed: ${
      scans.results.filter((r) => r.status === "completed").length
    }/${scans.results.length}`,
  );
}

function packageFile(rel: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, "..", rel);
  try {
    return existsSync(candidate) ? readFileSync(candidate, "utf8") : null;
  } catch {
    return null;
  }
}

const program = new Command();

program
  .name("repoguard")
  .description("Tool-independent repository auditing framework for coding agents.")
  .version("0.1.0");

program
  .command("init")
  .description("Create the output workspace and a starter config.")
  .argument("[repository]", "target repository path", ".")
  .action((repository: string) => {
    const repo = resolveRepo(repository);
    const { config } = loadConfig(repo);
    const dir = outDir(repo, config);
    for (const sub of ["scans", "reports", "instructions", "fixes"]) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
    const cfgPath = join(repo, "repoguard.config.yaml");
    if (!existsSync(cfgPath)) {
      const example = packageFile("repoguard.config.example.yaml");
      if (example) {
        writeFileSync(cfgPath, example, "utf8");
        console.log(`✔ Wrote starter config: ${cfgPath}`);
      }
    } else {
      console.log(`• Config already exists, left untouched: ${cfgPath}`);
    }
    console.log(`✔ Initialized RepoGuard workspace at ${dir}`);
  });

program
  .command("discover")
  .description("Detect languages, frameworks, APIs, and config; write discovery.json.")
  .argument("<repository>", "target repository path")
  .action((repository: string) => {
    const repo = resolveRepo(repository);
    const { config, source } = loadConfig(repo);
    let discovery: Discovery;
    try {
      discovery = discover(repo, config);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    writeJson(join(outDir(repo, config), "discovery.json"), discovery);
    console.log(`✔ Discovery written (config: ${source})`);
    console.log(
      `  ${discovery.fileCount} files · languages: ${
        discovery.languages.join(", ") || "none"
      } · endpoints: ${discovery.apiEndpoints.length} · databases: ${
        discovery.databases.join(", ") || "none"
      }`,
    );
  });

program
  .command("scan")
  .description("Run external + in-house scanners and collect evidence.")
  .argument("<repository>", "target repository path")
  .option("--security", "limit to security + dependency + config checks")
  .option("--api", "limit to API security + rate-limiting checks")
  .action((repository: string, opts: { security?: boolean; api?: boolean }) => {
    const repo = resolveRepo(repository);
    const { config: base } = loadConfig(repo);
    const config = applyScope(base, opts);
    const discovery = loadOrRunDiscovery(repo, config);
    let evidence: Evidence;
    try {
      evidence = collectEvidence(repo, discovery, config);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    writeJson(join(outDir(repo, config), "evidence.json"), evidence);
    writeJson(
      join(outDir(repo, config), "scans", "scan-report.json"),
      evidence.externalScans,
    );
    console.log("✔ Evidence collected.");
    for (const r of evidence.externalScans.results) {
      console.log(`  • ${r.tool.padEnd(14)} ${r.status}`);
    }
    for (const s of evidence.internalScanners) {
      console.log(`  • ${`[in-house] ${s.name}`.padEnd(28)} ${s.findings.length} seed finding(s)`);
    }
  });

program
  .command("instructions")
  .description("Generate agent-specific audit instructions.")
  .argument("<repository>", "target repository path")
  .requiredOption("--agent <agent>", AGENTS.join(" | "))
  .action((repository: string, opts: { agent: string }) => {
    const agent = opts.agent.toLowerCase() as AgentKind;
    if (!AGENTS.includes(agent)) {
      fail(`Unknown agent "${opts.agent}". Use one of: ${AGENTS.join(", ")}.`);
    }
    const repo = resolveRepo(repository);
    const { config } = loadConfig(repo);
    const discPath = join(outDir(repo, config), "discovery.json");
    let discovery: Discovery | null = null;
    if (existsSync(discPath)) {
      const parsed = discoverySchema.safeParse(readJsonFile(discPath));
      if (parsed.success) discovery = parsed.data;
    }
    const evidence = loadEvidence(repo, config);
    const content = generateInstructions(agent, discovery, evidence);
    const path = join(outDir(repo, config), "instructions", `${agent}-instructions.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    console.log(`✔ Instructions written: ${path}`);
    if (!discovery) console.log("  (No discovery.json — run `repoguard discover` for richer context.)");
  });

program
  .command("audit")
  .description("Full pipeline: discover, collect evidence, instructions, reports.")
  .argument("<repository>", "target repository path")
  .option("--security", "limit to security + dependency + config checks")
  .option("--api", "limit to API security + rate-limiting checks")
  .option(
    "--fail-on <severity>",
    "exit 2 after reports when active findings meet critical|high|medium|low|informational|none",
  )
  .action((repository: string, opts: AuditOptions) => {
    const repo = resolveRepo(repository);
    const { config: base } = loadConfig(repo);
    const config = applyScope(base, opts);

    console.log("→ Discovering repository…");
    let discovery: Discovery;
    try {
      discovery = discover(repo, config);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    writeJson(join(outDir(repo, config), "discovery.json"), discovery);

    console.log("→ Collecting evidence (scanners)…");
    const evidence = collectEvidence(repo, discovery, config);
    writeJson(join(outDir(repo, config), "evidence.json"), evidence);
    writeJson(
      join(outDir(repo, config), "scans", "scan-report.json"),
      evidence.externalScans,
    );

    console.log("→ Generating agent instructions…");
    for (const agent of AGENTS) {
      const content = generateInstructions(agent, discovery, evidence);
      const path = join(outDir(repo, config), "instructions", `${agent}-instructions.md`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    }

    console.log("→ Building report…");
    // Seed findings.json from evidence if the agent hasn't written one yet.
    const findingsPath = join(outDir(repo, config), "findings.json");
    if (!existsSync(findingsPath)) writeFindings(repo, config, evidence.seedFindings);
    const findings = loadFindings(repo, config);
    writeReports(repo, config, discovery, evidence.externalScans, findings, evidence.apiInventory);

    console.log("\n✔ Audit complete.");
    console.log(
      "  Next: point an agent at .../instructions/<agent>-instructions.md, let it validate",
    );
    console.log(
      "  findings into findings.json, then run `repoguard report` (and `repoguard validate`).",
    );

    if (opts.failOn) {
      let threshold;
      try {
        threshold = parseFailureThreshold(opts.failOn);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
      const blocking = findingsAtOrAbove(findings, threshold);
      if (blocking.length > 0) {
        console.error(
          `✖ ${blocking.length} active finding(s) meet the ${threshold} failure threshold.`,
        );
        process.exitCode = 2;
      }
    }
  });

program
  .command("validate")
  .description("Deterministic validation pass over findings (confidence threshold).")
  .argument("[repository]", "target repository path", ".")
  .action((repository: string) => {
    const repo = resolveRepo(repository);
    const { config } = loadConfig(repo);
    const findings = loadFindings(repo, config);
    if (findings.length === 0) {
      console.log("• No findings to validate. Run `repoguard audit` and an agent review first.");
      return;
    }
    const min = config.mode.minimumConfidence;
    let reclassified = 0;
    const validated = findings.map((f) => {
      if (f.status === "potential" && f.confidence < min) {
        reclassified++;
        return { ...f, status: "manual-verification" as const };
      }
      return f;
    });
    writeFindings(repo, config, validated);

    const count = (s: Finding["status"]) =>
      validated.filter((f) => f.status === s).length;
    console.log(`✔ Validation pass complete (minimumConfidence = ${min}).`);
    console.log(`  Confirmed: ${count("confirmed")}`);
    console.log(`  Potential: ${count("potential")}`);
    console.log(`  Manual verification: ${count("manual-verification")} (+${reclassified} reclassified)`);
    console.log(`  Rejected: ${count("rejected")}`);
    console.log(
      "  Note: this is a deterministic threshold pass. Full false-positive removal",
    );
    console.log(
      "  requires an agent following the finding-validation instructions.",
    );
  });

program
  .command("report")
  .description("Rebuild reports from existing discovery, evidence, and findings.")
  .argument("[repository]", "target repository path", ".")
  .action((repository: string) => {
    const repo = resolveRepo(repository);
    const { config } = loadConfig(repo);
    const discPath = join(outDir(repo, config), "discovery.json");
    if (!existsSync(discPath)) {
      fail(`No discovery.json. Run \`repoguard discover ${repository}\` first.`);
    }
    const discParsed = discoverySchema.safeParse(readJsonFile(discPath));
    if (!discParsed.success) fail(`discovery.json is invalid: ${discParsed.error.message}`);

    const evidence = loadEvidence(repo, config);
    const scans = evidence?.externalScans ?? {
      repository: repo,
      generatedAt: new Date().toISOString(),
      results: [],
    };
    const findings = loadFindings(repo, config);
    writeReports(
      repo,
      config,
      discParsed.data,
      scans,
      findings,
      evidence?.apiInventory ?? [],
    );
  });

program
  .command("fix")
  .description("Generate a remediation plan for one finding (never edits by default).")
  .argument("<findingId>", "finding id, e.g. RG-AUTH-001")
  .argument("[repository]", "target repository path", ".")
  .action((findingId: string, repository: string) => {
    const repo = resolveRepo(repository);
    const { config } = loadConfig(repo);
    const findings = loadFindings(repo, config);
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) {
      fail(`Finding "${findingId}" not found in findings.json.`);
    }
    const template = packageFile("templates/remediation-plan.md");
    if (!template) fail("Remediation template not found in package.");

    const plan = renderTemplate(template, finding);
    const path = join(outDir(repo, config), "fixes", `${findingId}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, plan, "utf8");
    console.log(`✔ Remediation plan written: ${path}`);
    if (!config.mode.modifyFiles) {
      console.log(
        "  mode.modifyFiles is false — RepoGuard produced a plan only and did not edit any file.",
      );
    } else {
      console.log(
        "  mode.modifyFiles is true — have your agent apply the plan, then re-run scanners.",
      );
    }
  });

/** Minimal {{field}} substitution for the remediation template. */
function renderTemplate(template: string, finding: Finding): string {
  const map: Record<string, string> = {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    status: finding.status,
    file: finding.file ?? "(unknown)",
    line: finding.line ? String(finding.line) : "?",
    endpoint: finding.endpoint ? `(${finding.endpoint})` : "",
    triggerCondition: finding.triggerCondition || "(not specified)",
    recommendedFix: finding.recommendedFix || "(propose a fix based on the evidence)",
  };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => map[key] ?? "");
}

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
