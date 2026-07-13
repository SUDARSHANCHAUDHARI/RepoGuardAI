import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { configSchema } from "./schemas.js";
import type { RepoGuardConfig } from "./types.js";

const CONFIG_FILENAMES = [
  "repoguard.config.yaml",
  "repoguard.config.yml",
  ".repoguard.yaml",
  ".repoguard.yml",
];

/** Returns the default configuration (all schema defaults applied). */
export function defaultConfig(): RepoGuardConfig {
  return configSchema.parse({});
}

/**
 * Directory names to skip when walking the repo: the user's exclude list plus
 * RepoGuard's own output directory (so a second run never scans its own
 * discovery/evidence/instruction/report artifacts).
 */
export function walkExcludes(config: RepoGuardConfig): string[] {
  const outName =
    config.report.outputDirectory.split("/").filter(Boolean).pop() ??
    config.report.outputDirectory;
  return [
    ...new Set([
      ...config.exclude,
      outName,
      ".repoguard",
      ".repoguard-tool",
      ".git",
    ]),
  ];
}

/**
 * Loads and validates configuration from the target repository, falling back
 * to defaults when no file is present. Malformed YAML or schema violations
 * throw a descriptive error rather than crashing silently.
 */
export function loadConfig(repoRoot: string): {
  config: RepoGuardConfig;
  source: string;
} {
  for (const name of CONFIG_FILENAMES) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) continue;

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(
        `Failed to read config file at ${path}: ${errMessage(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw) ?? {};
    } catch (err) {
      throw new Error(
        `Config file ${path} is not valid YAML: ${errMessage(err)}`,
      );
    }

    const result = configSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Config file ${path} failed validation:\n${formatZodError(result.error)}`,
      );
    }
    return { config: result.data, source: path };
  }

  return { config: defaultConfig(), source: "<defaults>" };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatZodError(error: {
  issues: { path: (string | number)[]; message: string }[];
}): string {
  return error.issues
    .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("\n");
}
