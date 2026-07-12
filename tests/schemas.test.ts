import { describe, it, expect } from "vitest";
import {
  findingSchema,
  findingsFileSchema,
  configSchema,
} from "../src/schemas.js";
import { defaultConfig } from "../src/config.js";

describe("findingSchema", () => {
  const base = {
    id: "RG-AUTH-001",
    title: "Login endpoint has no rate limiting",
    severity: "high",
    category: "api-security",
    status: "confirmed",
    confidence: 95,
    file: "src/routes/auth.ts",
    line: 42,
    endpoint: "POST /api/login",
  };

  it("accepts a valid finding and applies defaults", () => {
    const parsed = findingSchema.parse(base);
    expect(parsed.description).toBe("");
    expect(parsed.reproduction).toEqual([]);
    expect(parsed.source).toBe("manual");
  });

  it("rejects an invalid severity", () => {
    const r = findingSchema.safeParse({ ...base, severity: "urgent" });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const r = findingSchema.safeParse({ ...base, status: "maybe" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed id", () => {
    const r = findingSchema.safeParse({ ...base, id: "auth-1" });
    expect(r.success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const r = findingSchema.safeParse({ ...base, confidence: 150 });
    expect(r.success).toBe(false);
  });

  it("allows null file/line/endpoint", () => {
    const r = findingSchema.safeParse({
      ...base,
      file: null,
      line: null,
      endpoint: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("findingsFileSchema", () => {
  it("validates a findings file wrapper", () => {
    const r = findingsFileSchema.safeParse({
      repository: "/tmp/x",
      generatedAt: new Date().toISOString(),
      findings: [],
    });
    expect(r.success).toBe(true);
  });
});

describe("configSchema", () => {
  it("fills defaults from an empty object", () => {
    const cfg = configSchema.parse({});
    expect(cfg.report.outputDirectory).toBe("repoguard-results");
    expect(cfg.report.formats).toContain("sarif");
    expect(cfg.scanners.timeoutMs).toBeGreaterThan(0);
    expect(cfg.exclude).toContain("node_modules");
    expect(cfg.audit.security).toBe(true);
    expect(cfg.mode.minimumConfidence).toBe(75);
  });

  it("defaultConfig matches schema defaults", () => {
    expect(defaultConfig().report.outputDirectory).toBe("repoguard-results");
  });

  it("rejects minimumConfidence out of range", () => {
    const r = configSchema.safeParse({ mode: { minimumConfidence: 500 } });
    expect(r.success).toBe(false);
  });

  it("rejects a negative timeout", () => {
    const r = configSchema.safeParse({ scanners: { timeoutMs: -5 } });
    expect(r.success).toBe(false);
  });
});
