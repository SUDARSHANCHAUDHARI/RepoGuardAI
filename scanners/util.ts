import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { findingSchema } from "../src/schemas.js";
import type { Finding, InternalScanContext } from "../src/types.js";

/** Extensions we treat as text and are willing to read line-by-line. */
const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".kt", ".rb", ".php", ".cs", ".swift", ".c", ".h", ".cpp", ".scala", ".ex",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".properties", ".xml", ".html", ".sh", ".txt", ".md", ".gradle",
]);

export function isTextFile(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  if (base.startsWith(".env")) return true;
  return TEXT_EXTS.has(extname(rel).toLowerCase());
}

/** Reads a file relative to the repo root, returning "" on any failure. */
export function readText(ctx: InternalScanContext, rel: string): string {
  try {
    return readFileSync(join(ctx.repoRoot, rel), "utf8");
  } catch {
    return "";
  }
}

/** Iterates readable text files, capping how many we open for safety. */
export function textFiles(
  ctx: InternalScanContext,
  maxFiles = 5_000,
): string[] {
  return ctx.files.filter(isTextFile).slice(0, maxFiles);
}

/**
 * Builds a schema-valid finding. Deterministic scanners never emit
 * "confirmed" — they surface leads for the AI/human to validate.
 */
export function makeFinding(
  area: string,
  n: number,
  partial: Partial<Finding> &
    Pick<Finding, "title" | "severity" | "category">,
): Finding {
  const id = `RG-${area}-${String(n).padStart(3, "0")}`;
  return findingSchema.parse({
    status: "potential",
    confidence: 50,
    ...partial,
    id,
  });
}
