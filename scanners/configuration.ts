import type { Finding, InternalScanContext } from "../src/types.js";
import { makeFinding, readText, isTextFile } from "./util.js";

interface ConfigPattern {
  label: string;
  regex: RegExp;
  severity: Finding["severity"];
  fix: string;
}

const PATTERNS: ConfigPattern[] = [
  {
    label: "TLS certificate verification disabled",
    regex: /rejectUnauthorized\s*[:=]\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
    severity: "high",
    fix: "Do not disable TLS verification; fix the certificate chain instead.",
  },
  {
    label: "Wildcard CORS origin",
    regex: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]/,
    severity: "medium",
    fix: "Restrict CORS to an explicit origin allowlist; avoid '*' with credentials.",
  },
  {
    label: "Debug mode enabled",
    regex: /\bdebug\s*[:=]\s*true\b|\bDEBUG\s*=\s*true\b/i,
    severity: "low",
    fix: "Disable debug mode in production configuration.",
  },
  {
    label: "Insecure cookie flag",
    regex: /secure\s*:\s*false|httpOnly\s*:\s*false/i,
    severity: "medium",
    fix: "Set cookies with Secure and HttpOnly (and SameSite) in production.",
  },
];

/** Only inspect files that look like configuration or env. */
function isConfigCandidate(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  return (
    isTextFile(rel) &&
    (base.startsWith(".env") ||
      /\.(ya?ml|toml|ini|cfg|conf|properties|json)$/i.test(base) ||
      /\.config\.(js|ts|mjs|cjs)$/i.test(base) ||
      /(config|settings|server|app)\.(js|ts|mjs|cjs|py|go|rb)$/i.test(base))
  );
}

export const configurationScanner = {
  name: "configuration",
  description: "Risky configuration flags (TLS, CORS, debug, cookies).",
  run(ctx: InternalScanContext): Finding[] {
    const findings: Finding[] = [];
    let n = 0;

    for (const rel of ctx.files.filter(isConfigCandidate).slice(0, 3_000)) {
      const content = readText(ctx, rel);
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const p of PATTERNS) {
          if (!p.regex.test(line)) continue;
          findings.push(
            makeFinding("CONF", ++n, {
              title: `${p.label} in ${rel}`,
              severity: p.severity,
              category: "configuration",
              status: "potential",
              confidence: 55,
              file: rel,
              line: i + 1,
              description: `Configuration pattern detected: ${p.label}.`,
              evidence: `${rel}:${i + 1}`,
              recommendedFix: p.fix,
              source: "scanner:configuration",
            }),
          );
        }
      }
    }
    return findings;
  },
};
