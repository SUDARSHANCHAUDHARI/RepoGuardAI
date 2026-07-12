import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { walkExcludes } from "./config.js";
import { scanReportSchema } from "./schemas.js";
import type {
  Discovery,
  RepoGuardConfig,
  ScanReport,
  ScanResult,
  ScannerDef,
} from "./types.js";

/**
 * Registry of supported EXTERNAL scanners (host binaries). Each declares how to
 * probe availability, how to run, when it applies, and which audit toggle gates
 * it. RepoGuard NEVER installs these — it only runs the ones already present on
 * the host and never mutates the target.
 */
export const SCANNERS: ScannerDef[] = [
  {
    name: "gitleaks",
    bin: "gitleaks",
    versionArgs: ["version"],
    args: ["detect", "--no-git", "--report-format", "json", "--report-path", "-"],
    appliesTo: () => true,
    gate: "security",
    description: "Secret scanning across the working tree.",
  },
  {
    name: "semgrep",
    bin: "semgrep",
    versionArgs: ["--version"],
    args: ["scan", "--config", "auto", "--json", "--quiet"],
    appliesTo: () => true,
    gate: "security",
    extraArgs: (c) => walkExcludes(c).flatMap((d) => ["--exclude", d]),
    description: "Static analysis for security and correctness patterns.",
  },
  {
    name: "trivy",
    bin: "trivy",
    versionArgs: ["--version"],
    args: ["fs", "--scanners", "vuln,secret,misconfig", "--format", "json", "."],
    appliesTo: () => true,
    gate: "security",
    extraArgs: (c) => walkExcludes(c).flatMap((d) => ["--skip-dirs", `**/${d}`]),
    description: "Filesystem vulnerability, secret and misconfiguration scan.",
  },
  {
    name: "osv-scanner",
    bin: "osv-scanner",
    versionArgs: ["--version"],
    args: ["--format", "json", "-r", "."],
    appliesTo: (d) => d.dependencyFiles.length > 0,
    gate: "dependencies",
    description: "Open Source Vulnerability database lookup for dependencies.",
  },
  {
    name: "npm-audit",
    bin: "npm",
    versionArgs: ["--version"],
    args: ["audit", "--json"],
    appliesTo: (d) => d.packageManagers.includes("npm"),
    gate: "dependencies",
    description: "npm dependency vulnerability audit.",
  },
  {
    name: "pnpm-audit",
    bin: "pnpm",
    versionArgs: ["--version"],
    args: ["audit", "--json"],
    appliesTo: (d) => d.packageManagers.includes("pnpm"),
    gate: "dependencies",
    description: "pnpm dependency vulnerability audit.",
  },
  {
    name: "pip-audit",
    bin: "pip-audit",
    versionArgs: ["--version"],
    args: ["--format", "json"],
    appliesTo: (d) =>
      d.packageManagers.some((p) => p.startsWith("pip") || p === "poetry"),
    gate: "dependencies",
    description: "Python dependency vulnerability audit.",
  },
  {
    name: "govulncheck",
    bin: "govulncheck",
    versionArgs: ["-version"],
    args: ["-json", "./..."],
    appliesTo: (d) => d.packageManagers.includes("go-modules"),
    gate: "dependencies",
    description: "Go vulnerability database check.",
  },
  {
    name: "cargo-audit",
    bin: "cargo",
    versionArgs: ["--version"],
    args: ["audit", "--json"],
    appliesTo: (d) => d.packageManagers.includes("cargo"),
    gate: "dependencies",
    description: "Rust crate vulnerability audit (cargo-audit plugin).",
  },
];

/** Checks whether a scanner binary is invokable on this host. */
export function isToolAvailable(def: ScannerDef): boolean {
  try {
    const res = spawnSync(def.bin, def.versionArgs, {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    // ENOENT surfaces as res.error; any spawnable process (even non-zero) counts.
    return res.error === undefined && res.status !== null;
  } catch {
    return false;
  }
}

/** Whether a scanner is disabled by config or gated off by an audit toggle. */
function isEnabled(def: ScannerDef, config: RepoGuardConfig): boolean {
  if (config.scanners.disabled.includes(def.name)) return false;
  return config.audit[def.gate];
}

/** Scanners that config permits to run (not disabled, gate on). */
export function selectScanners(config: RepoGuardConfig): ScannerDef[] {
  return SCANNERS.filter((s) => isEnabled(s, config));
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Runs applicable + available scanners against the target repo. Every scanner
 * appears in the report — disabled/gated/unavailable/not-applicable ones are
 * recorded as skipped rather than silently dropped. Individual failures never
 * abort the batch.
 */
export function runScanners(
  repoRoot: string,
  discovery: Discovery,
  config: RepoGuardConfig,
): ScanReport {
  const scansDir = join(repoRoot, config.report.outputDirectory, "scans");
  mkdirSync(scansDir, { recursive: true });

  const results: ScanResult[] = [];

  for (const def of SCANNERS) {
    const runArgs = [...def.args, ...(def.extraArgs?.(config) ?? [])];
    const command = `${def.bin} ${runArgs.join(" ")}`;
    const base = {
      tool: def.name,
      available: false,
      status: "skipped-unavailable" as ScanResult["status"],
      command,
      exitCode: null as number | null,
      durationMs: 0,
      stdoutFile: null as string | null,
      stderrFile: null as string | null,
      note: "",
    };

    if (!isEnabled(def, config)) {
      results.push({
        ...base,
        status: "skipped-disabled",
        note: config.scanners.disabled.includes(def.name)
          ? "Disabled in config.scanners.disabled."
          : `Gated off (audit.${def.gate} = false).`,
      });
      continue;
    }

    if (!def.appliesTo(discovery)) {
      results.push({
        ...base,
        available: isToolAvailable(def),
        status: "skipped-not-applicable",
        note: "Scanner does not apply to the detected stack.",
      });
      continue;
    }

    if (!isToolAvailable(def)) {
      results.push({
        ...base,
        status: "skipped-unavailable",
        note: `Binary "${def.bin}" not found on PATH. Install it to enable this scan.`,
      });
      continue;
    }

    const started = Date.now();
    let run: ReturnType<typeof spawnSync>;
    try {
      run = spawnSync(def.bin, runArgs, {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: config.scanners.timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
    } catch (err) {
      results.push({
        ...base,
        available: true,
        status: "error",
        durationMs: Date.now() - started,
        note: `Failed to execute scanner: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    const durationMs = Date.now() - started;
    const safe = sanitizeName(def.name);
    writeFileSync(join(scansDir, `${safe}.stdout.txt`), run.stdout ?? "", "utf8");
    writeFileSync(join(scansDir, `${safe}.stderr.txt`), run.stderr ?? "", "utf8");

    const timedOut =
      run.error !== undefined &&
      (run.error as NodeJS.ErrnoException).code === "ETIMEDOUT";

    const relDir = join(config.report.outputDirectory, "scans");
    results.push({
      ...base,
      available: true,
      status: timedOut ? "timeout" : run.error ? "error" : "completed",
      exitCode: run.status,
      durationMs,
      stdoutFile: join(relDir, `${safe}.stdout.txt`),
      stderrFile: join(relDir, `${safe}.stderr.txt`),
      note: timedOut
        ? `Timed out after ${config.scanners.timeoutMs}ms.`
        : run.error
          ? `Process error: ${run.error.message}`
          : run.status !== 0
            ? `Exited non-zero (${run.status}); many scanners use this to signal findings — inspect the output file.`
            : "",
    });
  }

  return scanReportSchema.parse({
    repository: repoRoot,
    generatedAt: new Date().toISOString(),
    results,
  });
}
