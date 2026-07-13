import { findingSchema } from "./schemas.js";
import type { Finding, Severity } from "./types.js";

/**
 * Converts raw external-scanner JSON output into RepoGuard findings. These are
 * always `potential` (scanner-derived) — the AI/human validates them. Parsers
 * are defensive: malformed or empty output yields an empty list, never a throw.
 */

const MAX_PER_TOOL = 200;

function mk(
  prefix: string,
  n: number,
  partial: Partial<Finding> & Pick<Finding, "title" | "severity" | "category" | "source">,
): Finding {
  return findingSchema.parse({
    status: "potential",
    confidence: 60,
    ...partial,
    id: `RG-${prefix}-${String(n).padStart(3, "0")}`,
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Normalizes common scanner severity strings to RepoGuard severities. */
function normSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (["critical"].includes(v)) return "critical";
  if (["high", "error"].includes(v)) return "high";
  if (["medium", "moderate", "warning"].includes(v)) return "medium";
  if (["low"].includes(v)) return "low";
  if (["info", "informational", "none", "unknown"].includes(v)) return "informational";
  return "medium";
}

function toStr(v: unknown): string {
  return v == null ? "" : String(v);
}

function toLine(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------

function parseSemgrep(raw: string): Finding[] {
  const root = asRecord(parseJson(raw));
  const results = asArray(root.results);
  const out: Finding[] = [];
  let n = 0;
  for (const r of results.slice(0, MAX_PER_TOOL)) {
    const rec = asRecord(r);
    const extra = asRecord(rec.extra);
    const start = asRecord(rec.start);
    out.push(
      mk("SEMGREP", ++n, {
        title: `semgrep: ${toStr(rec.check_id).split(".").pop() || toStr(rec.check_id)}`,
        severity: normSeverity(extra.severity),
        category: "security",
        file: toStr(rec.path) || null,
        line: toLine(start.line),
        description: toStr(asRecord(extra.metadata).shortlink || extra.message),
        evidence: toStr(extra.message),
        source: "tool:semgrep",
      }),
    );
  }
  return out;
}

function parseGitleaks(raw: string): Finding[] {
  // gitleaks emits a JSON array of leaks.
  const arr = asArray(parseJson(raw));
  const out: Finding[] = [];
  let n = 0;
  for (const r of arr.slice(0, MAX_PER_TOOL)) {
    const rec = asRecord(r);
    out.push(
      mk("GITLEAKS", ++n, {
        title: `Secret: ${toStr(rec.RuleID || rec.Description) || "leak"}`,
        severity: "high",
        category: "secrets",
        file: toStr(rec.File) || null,
        line: toLine(rec.StartLine),
        description: toStr(rec.Description),
        evidence: toStr(rec.Match).slice(0, 200),
        impact: "Committed secret can be extracted and abused.",
        recommendedFix: "Rotate the secret and load it from a secret manager.",
        source: "tool:gitleaks",
      }),
    );
  }
  return out;
}

function parseNpmAudit(raw: string): Finding[] {
  const root = asRecord(parseJson(raw));
  const out: Finding[] = [];
  let n = 0;
  // npm v7+ shape: { vulnerabilities: { <name>: { severity, via: [...] } } }
  const vulns = asRecord(root.vulnerabilities);
  for (const [name, info] of Object.entries(vulns).slice(0, MAX_PER_TOOL)) {
    const rec = asRecord(info);
    const via = asArray(rec.via).find((v) => typeof v === "object");
    const title = via ? toStr(asRecord(via).title) : "";
    out.push(
      mk("NPM", ++n, {
        title: `Vulnerable dependency: ${name}${title ? ` — ${title}` : ""}`,
        severity: normSeverity(rec.severity),
        category: "dependency",
        description: `npm audit flagged "${name}" (range: ${toStr(rec.range)}).`,
        evidence: via ? toStr(asRecord(via).url) : "",
        recommendedFix: rec.fixAvailable ? "A fix is available; run npm audit fix / upgrade." : "No automatic fix; review the advisory.",
        source: "tool:npm-audit",
      }),
    );
  }
  // npm v6 shape: { advisories: { <id>: {...} } }
  const advisories = asRecord(root.advisories);
  for (const [, info] of Object.entries(advisories).slice(0, MAX_PER_TOOL)) {
    const rec = asRecord(info);
    out.push(
      mk("NPM", ++n, {
        title: `Vulnerable dependency: ${toStr(rec.module_name)} — ${toStr(rec.title)}`,
        severity: normSeverity(rec.severity),
        category: "dependency",
        description: toStr(rec.overview).slice(0, 300),
        evidence: toStr(rec.url),
        source: "tool:npm-audit",
      }),
    );
  }
  return out;
}

function parsePnpmAudit(raw: string): Finding[] {
  // pnpm audit --json: { advisories: { <id>: { module_name, severity, title, url } } }
  const root = asRecord(parseJson(raw));
  const advisories = asRecord(root.advisories);
  const out: Finding[] = [];
  let n = 0;
  for (const [, info] of Object.entries(advisories).slice(0, MAX_PER_TOOL)) {
    const rec = asRecord(info);
    out.push(
      mk("PNPM", ++n, {
        title: `Vulnerable dependency: ${toStr(rec.module_name)} — ${toStr(rec.title)}`,
        severity: normSeverity(rec.severity),
        category: "dependency",
        description: toStr(rec.overview || rec.title).slice(0, 300),
        evidence: toStr(rec.url),
        source: "tool:pnpm-audit",
      }),
    );
  }
  return out;
}

function parseOsv(raw: string): Finding[] {
  const root = asRecord(parseJson(raw));
  const out: Finding[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const res of asArray(root.results)) {
    for (const pkg of asArray(asRecord(res).packages)) {
      const p = asRecord(pkg);
      const info = asRecord(p.package);
      for (const vuln of asArray(p.vulnerabilities)) {
        if (n >= MAX_PER_TOOL) break;
        const v = asRecord(vuln);
        const key = [info.ecosystem, info.name, info.version, v.id]
          .map(toStr)
          .join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(
          mk("OSV", ++n, {
            title: `${toStr(info.name)}@${toStr(info.version)}: ${toStr(v.id)}`,
            severity: normSeverity(asRecord(v.database_specific).severity),
            category: "dependency",
            description: toStr(v.summary).slice(0, 300),
            evidence: toStr(v.id),
            source: "tool:osv-scanner",
          }),
        );
      }
    }
  }
  return out;
}

function parseTrivy(raw: string): Finding[] {
  const root = asRecord(parseJson(raw));
  const out: Finding[] = [];
  let n = 0;
  for (const result of asArray(root.Results)) {
    const r = asRecord(result);
    const target = toStr(r.Target);
    for (const vuln of asArray(r.Vulnerabilities)) {
      if (n >= MAX_PER_TOOL) break;
      const v = asRecord(vuln);
      out.push(
        mk("TRIVY", ++n, {
          title: `${toStr(v.PkgName)}: ${toStr(v.VulnerabilityID)}`,
          severity: normSeverity(v.Severity),
          category: "dependency",
          file: target || null,
          description: toStr(v.Title || v.Description).slice(0, 300),
          evidence: toStr(v.PrimaryURL),
          source: "tool:trivy",
        }),
      );
    }
    for (const sec of asArray(r.Secrets)) {
      if (n >= MAX_PER_TOOL) break;
      const s = asRecord(sec);
      out.push(
        mk("TRIVY", ++n, {
          title: `Secret: ${toStr(s.RuleID || s.Title)}`,
          severity: normSeverity(s.Severity),
          category: "secrets",
          file: target || null,
          line: toLine(s.StartLine),
          description: toStr(s.Title),
          source: "tool:trivy",
        }),
      );
    }
    for (const mis of asArray(r.Misconfigurations)) {
      if (n >= MAX_PER_TOOL) break;
      const m = asRecord(mis);
      out.push(
        mk("TRIVY", ++n, {
          title: `Misconfig: ${toStr(m.ID)} ${toStr(m.Title)}`.trim(),
          severity: normSeverity(m.Severity),
          category: "configuration",
          file: target || null,
          description: toStr(m.Description).slice(0, 300),
          source: "tool:trivy",
        }),
      );
    }
  }
  return out;
}

const PARSERS: Record<string, (raw: string) => Finding[]> = {
  semgrep: parseSemgrep,
  gitleaks: parseGitleaks,
  "npm-audit": parseNpmAudit,
  "pnpm-audit": parsePnpmAudit,
  "osv-scanner": parseOsv,
  trivy: parseTrivy,
};

/** Parses one scanner's raw stdout into findings, or [] if unsupported/empty. */
export function parseScannerFindings(tool: string, raw: string): Finding[] {
  if (!raw || !raw.trim()) return [];
  const parser = PARSERS[tool];
  if (!parser) return [];
  try {
    return parser(raw);
  } catch {
    return [];
  }
}

/** Tools for which RepoGuard can convert output into findings. */
export const PARSEABLE_TOOLS = Object.keys(PARSERS);
