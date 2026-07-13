import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("uses RepoGuard as the single normalized severity gate", () => {
    expect(source).toContain('REPOGUARD_OUTCOME: ${{ steps.repoguard.outcome }}');
    expect(source).not.toContain("OSV_OUTCOME:");
    expect(source).not.toContain("GITLEAKS_OUTCOME:");
  });

  it("installs OSV for RepoGuard instead of running an independent OSV gate", () => {
    expect(source).toContain(
      "go install github.com/google/osv-scanner/cmd/osv-scanner@v1.9.2",
    );
    expect(source).not.toContain("google/osv-scanner-action/");
  });
});

describe("repository security automation", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const dependabot = readFileSync(".github/dependabot.yml", "utf8");

  it("keeps only CI as a repository-local triggered workflow", () => {
    expect(existsSync(".github/workflows/daily-security.yml")).toBe(false);
    expect(existsSync(".github/workflows/codeql.yml")).toBe(false);
  });

  it("runs one compatibility CI job and cancels superseded runs", () => {
    expect(ci).toContain("node-version: 18");
    expect(ci).not.toContain("matrix:");
    expect(ci).toContain("cancel-in-progress: true");
  });

  it("checks dependency updates weekly with small PR limits", () => {
    expect(dependabot).toContain('package-ecosystem: "npm"');
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
    const config = parse(dependabot) as {
      updates: Array<{
        schedule?: { interval?: string };
        cooldown?: { "default-days"?: number };
        "open-pull-requests-limit"?: number;
        ignore?: Array<{ "update-types"?: string[] }>;
      }>;
    };
    expect(config.updates).toHaveLength(2);
    expect(
      config.updates.every((update) => update.cooldown?.["default-days"] === 7),
    ).toBe(true);
    expect(config.updates.every((update) => update.schedule?.interval === "weekly"))
      .toBe(true);
    expect(config.updates.map((update) => update["open-pull-requests-limit"]))
      .toEqual([2, 1]);
    expect(config.updates[0]?.ignore?.[0]?.["update-types"])
      .toEqual(["version-update:semver-major"]);
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
