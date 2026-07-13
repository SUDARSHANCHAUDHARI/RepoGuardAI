import {
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { auditReportSchema, SEVERITIES } from "./schemas.js";
import { parseFailureThreshold } from "./severity-gate.js";
import type { Severity } from "./types.js";

export interface ActionInputs {
  target: string;
  scope: string;
  failOn: string;
}

export interface ActionSummaryData {
  counts: Record<Severity, number>;
  reportDirectory: string;
}

export function buildAuditArgs(inputs: ActionInputs): string[] {
  if (!(["full", "security", "api"] as const).includes(inputs.scope as never)) {
    throw new Error("scope must be one of: full, security, api");
  }
  const args = ["audit", inputs.target];
  if (inputs.scope !== "full") args.push(`--${inputs.scope}`);
  if (inputs.failOn) {
    parseFailureThreshold(inputs.failOn);
    args.push("--fail-on", inputs.failOn);
  }
  return args;
}

export function renderActionSummary(data: ActionSummaryData): string {
  const rows = SEVERITIES.map(
    (severity) =>
      `| ${severity[0]!.toUpperCase()}${severity.slice(1)} | ${data.counts[severity]} |`,
  );
  return [
    "## RepoGuardAI security audit",
    "",
    "| Severity | Active findings |",
    "| --- | ---: |",
    ...rows,
    "",
    `Reports: \`${data.reportDirectory}\``,
    "",
  ].join("\n");
}

function actionInput(name: string, fallback: string): string {
  return process.env[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;
}

function writeActionValue(file: string | undefined, name: string, value: string): void {
  if (!file) return;
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Action output ${name} must be a single line.`);
  }
  appendFileSync(file, `${name}=${value}\n`, "utf8");
}

function emptyCounts(): Record<Severity, number> {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };
}

function reportCounts(path: string): Record<Severity, number> {
  if (!existsSync(path)) return emptyCounts();
  const report = auditReportSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  const counts = emptyCounts();
  for (const finding of report.findings) {
    if (finding.status !== "rejected") counts[finding.severity]++;
  }
  return counts;
}

export function runAction(): number {
  const target = resolve(process.cwd(), actionInput("TARGET", "."));
  const inputs: ActionInputs = {
    target,
    scope: actionInput("SCOPE", "security").toLowerCase(),
    failOn: actionInput("FAIL-ON", "high").toLowerCase(),
  };
  const args = buildAuditArgs(inputs);
  const actionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cliPath = join(actionRoot, "dist", "cli.js");
  const run = spawnSync(process.execPath, [cliPath, ...args], {
    stdio: "inherit",
    windowsHide: true,
  });

  const { config } = loadConfig(target);
  const reportDirectory = join(target, config.report.outputDirectory, "reports");
  const jsonReport = join(reportDirectory, "audit-report.json");
  const sarifReport = join(reportDirectory, "audit-report.sarif");
  writeActionValue(process.env.GITHUB_OUTPUT, "report-directory", reportDirectory);
  writeActionValue(process.env.GITHUB_OUTPUT, "json-report", jsonReport);
  writeActionValue(process.env.GITHUB_OUTPUT, "sarif-report", sarifReport);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      renderActionSummary({ counts: reportCounts(jsonReport), reportDirectory }),
      "utf8",
    );
  }

  if (run.error) throw run.error;
  return run.status ?? 1;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  try {
    process.exitCode = runAction();
  } catch (error) {
    console.error(`✖ RepoGuardAI Action failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
