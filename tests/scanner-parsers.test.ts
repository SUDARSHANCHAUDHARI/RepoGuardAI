import { describe, it, expect } from "vitest";
import { parseScannerFindings } from "../src/scanner-parsers.js";
import { findingSchema } from "../src/schemas.js";

function allValid(findings: unknown[]) {
  return findings.every((f) => findingSchema.safeParse(f).success);
}

describe("parseScannerFindings", () => {
  it("returns [] for empty, malformed, or unsupported input", () => {
    expect(parseScannerFindings("semgrep", "")).toEqual([]);
    expect(parseScannerFindings("semgrep", "not json")).toEqual([]);
    expect(parseScannerFindings("unknown-tool", "{}")).toEqual([]);
  });

  it("parses semgrep results with severity mapping", () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: "javascript.lang.security.audit.xss",
          path: "src/a.js",
          start: { line: 10 },
          extra: { message: "XSS risk", severity: "ERROR", metadata: {} },
        },
      ],
    });
    const f = parseScannerFindings("semgrep", raw);
    expect(f).toHaveLength(1);
    expect(allValid(f)).toBe(true);
    expect(f[0]!.category).toBe("security");
    expect(f[0]!.severity).toBe("high"); // ERROR -> high
    expect(f[0]!.file).toBe("src/a.js");
    expect(f[0]!.line).toBe(10);
    expect(f[0]!.source).toBe("tool:semgrep");
    expect(f[0]!.id).toMatch(/^RG-SEMGREP-\d{3}$/);
  });

  it("parses gitleaks leaks as secrets", () => {
    const raw = JSON.stringify([
      { RuleID: "aws-access-key", Description: "AWS key", File: "config.js", StartLine: 3, Match: "AKIA..." },
    ]);
    const f = parseScannerFindings("gitleaks", raw);
    expect(f).toHaveLength(1);
    expect(f[0]!.category).toBe("secrets");
    expect(f[0]!.severity).toBe("high");
    expect(f[0]!.file).toBe("config.js");
    expect(f[0]!.source).toBe("tool:gitleaks");
  });

  it("parses npm audit v7 vulnerabilities as dependency findings", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        lodash: {
          severity: "high",
          range: "<4.17.21",
          via: [{ title: "Prototype Pollution", url: "https://x" }],
          fixAvailable: true,
        },
      },
    });
    const f = parseScannerFindings("npm-audit", raw);
    expect(f).toHaveLength(1);
    expect(f[0]!.category).toBe("dependency");
    expect(f[0]!.severity).toBe("high");
    expect(f[0]!.title).toContain("lodash");
    expect(f[0]!.source).toBe("tool:npm-audit");
  });

  it("parses osv-scanner and trivy dependency vulns", () => {
    const osv = parseScannerFindings(
      "osv-scanner",
      JSON.stringify({
        results: [
          {
            packages: [
              {
                package: { name: "left-pad", version: "1.0.0" },
                vulnerabilities: [{ id: "GHSA-xxxx", summary: "bad" }],
              },
            ],
          },
        ],
      }),
    );
    expect(osv).toHaveLength(1);
    expect(osv[0]!.title).toContain("left-pad");
    expect(osv[0]!.category).toBe("dependency");

    const trivy = parseScannerFindings(
      "trivy",
      JSON.stringify({
        Results: [
          {
            Target: "package-lock.json",
            Vulnerabilities: [
              { PkgName: "minimist", VulnerabilityID: "CVE-2021-1", Severity: "CRITICAL", Title: "proto pollution", PrimaryURL: "http://x" },
            ],
            Misconfigurations: [{ ID: "DS002", Title: "root user", Severity: "LOW" }],
          },
        ],
      }),
    );
    expect(trivy.length).toBe(2);
    expect(trivy.find((x) => x.category === "dependency")!.severity).toBe("critical");
    expect(trivy.find((x) => x.category === "configuration")).toBeDefined();
    expect(allValid(trivy)).toBe(true);
  });
});
