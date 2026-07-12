import { describe, it, expect } from "vitest";
import {
  isToolAvailable,
  selectScanners,
  SCANNERS,
} from "../src/scanner-runner.js";
import { defaultConfig } from "../src/config.js";
import type { ScannerDef } from "../src/types.js";

const fakeAvailable: ScannerDef = {
  name: "node-probe",
  bin: "node",
  versionArgs: ["--version"],
  args: ["--version"],
  appliesTo: () => true,
  gate: "security",
  description: "probe",
};

const fakeMissing: ScannerDef = {
  name: "definitely-missing",
  bin: "definitely-not-a-real-binary-xyz-123",
  versionArgs: ["--version"],
  args: ["--version"],
  appliesTo: () => true,
  gate: "security",
  description: "probe",
};

describe("isToolAvailable", () => {
  it("returns true for an installed binary (node)", () => {
    expect(isToolAvailable(fakeAvailable)).toBe(true);
  });

  it("returns false for a missing binary", () => {
    expect(isToolAvailable(fakeMissing)).toBe(false);
  });
});

describe("selectScanners", () => {
  it("returns all scanners by default", () => {
    expect(selectScanners(defaultConfig())).toHaveLength(SCANNERS.length);
  });

  it("honours the disabled list", () => {
    const cfg = defaultConfig();
    cfg.scanners.disabled = ["gitleaks", "trivy"];
    const names = selectScanners(cfg).map((s) => s.name);
    expect(names).not.toContain("gitleaks");
    expect(names).not.toContain("trivy");
  });

  it("gates security scanners off when audit.security is false", () => {
    const cfg = defaultConfig();
    cfg.audit.security = false;
    const names = selectScanners(cfg).map((s) => s.name);
    expect(names).not.toContain("gitleaks");
    expect(names).not.toContain("semgrep");
    expect(names).not.toContain("trivy");
    // dependency scanners still selectable
    expect(names).toContain("osv-scanner");
  });

  it("gates dependency scanners off when audit.dependencies is false", () => {
    const cfg = defaultConfig();
    cfg.audit.dependencies = false;
    const names = selectScanners(cfg).map((s) => s.name);
    expect(names).not.toContain("osv-scanner");
    expect(names).not.toContain("npm-audit");
    expect(names).toContain("gitleaks");
  });
});

describe("SCANNERS registry", () => {
  it("has unique names and required fields", () => {
    const names = SCANNERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SCANNERS) {
      expect(s.bin).toBeTruthy();
      expect(Array.isArray(s.args)).toBe(true);
      expect(typeof s.appliesTo).toBe("function");
      expect(["security", "dependencies"]).toContain(s.gate);
    }
  });
});
