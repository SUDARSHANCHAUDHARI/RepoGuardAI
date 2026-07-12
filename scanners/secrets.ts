import type { Finding, InternalScanContext } from "../src/types.js";
import { makeFinding, readText, textFiles } from "./util.js";

interface Pattern {
  label: string;
  regex: RegExp;
  severity: Finding["severity"];
}

const PATTERNS: Pattern[] = [
  { label: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/, severity: "high" },
  {
    label: "Private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    severity: "critical",
  },
  { label: "Slack token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, severity: "high" },
  { label: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "high" },
  {
    label: "Generic assigned secret",
    regex:
      /\b(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    severity: "high",
  },
];

/** Substrings that mark a match as a placeholder, not a real secret. */
const PLACEHOLDER = [
  "example",
  "changeme",
  "your-",
  "your_",
  "placeholder",
  "xxxx",
  "process.env",
  "import.meta.env",
  "<",
  "dummy",
  "test",
  "sample",
];

const MAX_FINDINGS = 50;

export const secretsScanner = {
  name: "secrets",
  description: "Regex scan for committed credentials, keys, and tokens.",
  run(ctx: InternalScanContext): Finding[] {
    const findings: Finding[] = [];
    let n = 0;

    outer: for (const rel of textFiles(ctx)) {
      const content = readText(ctx, rel);
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.length > 500) continue; // skip minified/blob lines
        const lower = line.toLowerCase();
        for (const p of PATTERNS) {
          if (!p.regex.test(line)) continue;
          if (PLACEHOLDER.some((ph) => lower.includes(ph))) continue;
          findings.push(
            makeFinding("SECRET", ++n, {
              title: `Possible ${p.label} in ${rel}`,
              severity: p.severity,
              category: "secrets",
              status: "potential",
              confidence: 55,
              file: rel,
              line: i + 1,
              description: `A string matching a ${p.label} pattern was found.`,
              evidence: `${rel}:${i + 1}`,
              impact:
                "Committed credentials can be extracted from history and abused.",
              triggerCondition: "Anyone with repository read access.",
              recommendedFix:
                "Remove the secret, rotate it, and load from a secret manager/env.",
              source: "scanner:secrets",
            }),
          );
          if (findings.length >= MAX_FINDINGS) break outer;
        }
      }
    }
    return findings;
  },
};
