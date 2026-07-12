import { walkRepo } from "./discovery.js";
import { walkExcludes } from "./config.js";
import { runScanners } from "./scanner-runner.js";
import { evidenceSchema } from "./schemas.js";
import { INTERNAL_SCANNERS, buildApiInventory } from "../scanners/index.js";
import type {
  Discovery,
  Evidence,
  Finding,
  InternalScanContext,
  InternalScannerResult,
  RepoGuardConfig,
} from "./types.js";

/**
 * Collects deterministic evidence before any AI review:
 *   1. runs external scanners (when installed + enabled),
 *   2. runs the in-house scanners over the file tree,
 *   3. builds the API inventory,
 *   4. aggregates seed findings (all "potential"/"manual-verification").
 *
 * The result feeds the AI review step; the AI validates and elevates/rejects.
 */
export function collectEvidence(
  repoRoot: string,
  discovery: Discovery,
  config: RepoGuardConfig,
): Evidence {
  const externalScans = runScanners(repoRoot, discovery, config);

  const { files } = walkRepo(repoRoot, walkExcludes(config), config.discovery.maxFiles);
  const ctx: InternalScanContext = { repoRoot, files, discovery };

  const internalScanners: InternalScannerResult[] = [];
  const seedFindings: Finding[] = [];

  for (const scanner of INTERNAL_SCANNERS) {
    let findings: Finding[] = [];
    let note = "";
    try {
      findings = scanner.run(ctx);
    } catch (err) {
      note = `Scanner errored: ${err instanceof Error ? err.message : String(err)}`;
    }
    internalScanners.push({
      name: scanner.name,
      description: scanner.description,
      findings,
      note,
    });
    seedFindings.push(...findings);
  }

  const apiInventory = buildApiInventory(ctx);

  return evidenceSchema.parse({
    repository: repoRoot,
    generatedAt: new Date().toISOString(),
    externalScans,
    internalScanners,
    apiInventory,
    seedFindings,
  });
}
