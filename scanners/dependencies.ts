import { basename } from "node:path";
import type { Finding, InternalScanContext } from "../src/types.js";
import { makeFinding, readText } from "./util.js";

/**
 * Deterministic dependency hygiene checks. It does NOT resolve CVEs — that is
 * the job of the external scanners (osv-scanner, npm/pnpm audit, etc.). This
 * only flags manifest-level risks visible without a network.
 */
export const dependenciesScanner = {
  name: "dependencies",
  description: "Manifest hygiene: floating versions and missing lockfiles.",
  run(ctx: InternalScanContext): Finding[] {
    const findings: Finding[] = [];
    let n = 0;

    const pkgFiles = ctx.files.filter((f) => basename(f) === "package.json");
    const hasLock = ctx.files.some((f) =>
      ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json"].includes(
        basename(f),
      ),
    );

    for (const rel of pkgFiles) {
      const raw = readText(ctx, rel);
      if (!raw) continue;
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        findings.push(
          makeFinding("DEP", ++n, {
            title: `Unparseable manifest ${rel}`,
            severity: "low",
            category: "dependency",
            status: "manual-verification",
            confidence: 40,
            file: rel,
            description: "package.json could not be parsed as JSON.",
            source: "scanner:dependencies",
          }),
        );
        continue;
      }

      for (const block of ["dependencies", "devDependencies"]) {
        const deps = pkg[block];
        if (!deps || typeof deps !== "object") continue;
        for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
          if (range === "*" || range === "latest") {
            findings.push(
              makeFinding("DEP", ++n, {
                title: `Floating version for "${name}" (${String(range)})`,
                severity: "low",
                category: "dependency",
                status: "potential",
                confidence: 60,
                file: rel,
                description: `Dependency "${name}" uses an unpinned range "${String(range)}".`,
                impact:
                  "Unpinned versions can pull unexpected, possibly malicious, updates.",
                recommendedFix: "Pin to a known-good version range and commit a lockfile.",
                source: "scanner:dependencies",
              }),
            );
          }
        }
      }
    }

    if (pkgFiles.length > 0 && !hasLock) {
      findings.push(
        makeFinding("DEP", ++n, {
          title: "No lockfile present alongside package.json",
          severity: "low",
          category: "dependency",
          status: "potential",
          confidence: 65,
          file: pkgFiles[0] ?? null,
          description: "A Node manifest exists but no lockfile was found.",
          impact: "Builds are not reproducible; transitive versions can drift.",
          recommendedFix: "Commit a lockfile (package-lock.json / pnpm-lock.yaml).",
          source: "scanner:dependencies",
        }),
      );
    }

    return findings;
  },
};
