import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowPath = ".github/workflows/reusable-security.yml";
const source = readFileSync(workflowPath, "utf8");
const workflow = parse(source) as {
  jobs: Record<string, { permissions?: Record<string, string> }>;
};

describe("reusable security workflow", () => {
  it("is callable and keeps write permissions out of the scan job", () => {
    expect(workflow).toHaveProperty("jobs");
    expect(source).toContain("workflow_call:");
    expect(workflow.jobs.scan?.permissions).toEqual({ contents: "read" });
  });

  it("pins every remote action to a full commit SHA", () => {
    const remoteUses = [...source.matchAll(/uses:\s+([^\s#]+)/g)]
      .map((match) => match[1]!)
      .filter(
        (value) => !value.startsWith("./") && !value.startsWith("docker://"),
      );
    expect(remoteUses.length).toBeGreaterThan(0);
    for (const value of remoteUses) {
      expect(value).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("uploads evidence before the explicit final gate", () => {
    expect(source).toContain("if: always()");
    expect(source.indexOf("Upload RepoGuard reports")).toBeLessThan(
      source.indexOf("Apply final scan result"),
    );
  });
});

describe("repository security automation", () => {
  const daily = readFileSync(".github/workflows/daily-security.yml", "utf8");
  const codeql = readFileSync(".github/workflows/codeql.yml", "utf8");
  const dependabot = readFileSync(".github/dependabot.yml", "utf8");

  it("schedules the daily caller without pull_request_target", () => {
    expect(daily).toContain('cron: "17 20 * * *"');
    expect(daily).toContain(
      "uses: ./.github/workflows/reusable-security.yml",
    );
    expect(daily).not.toContain("pull_request_target");
  });

  it("configures native JavaScript/TypeScript CodeQL", () => {
    expect(codeql).toContain('language: ["javascript-typescript"]');
    expect(codeql).toContain("security-extended");
  });

  it("configures npm and GitHub Actions dependency updates", () => {
    expect(dependabot).toContain('package-ecosystem: "npm"');
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
    const config = parse(dependabot) as {
      updates: Array<{ cooldown?: { "default-days"?: number } }>;
    };
    expect(config.updates).toHaveLength(2);
    expect(
      config.updates.every((update) => update.cooldown?.["default-days"] === 7),
    ).toBe(true);
  });

  it("pins every remote action in every workflow", () => {
    const workflowSources = readdirSync(".github/workflows")
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .map((file) => readFileSync(`.github/workflows/${file}`, "utf8"));
    for (const workflowSource of workflowSources) {
      const remoteUses = [...workflowSource.matchAll(/uses:\s+([^\s#]+)/g)]
        .map((match) => match[1]!)
        .filter(
          (value) =>
            !value.startsWith("./") && !value.startsWith("docker://"),
        );
      for (const value of remoteUses) {
        expect(value).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
