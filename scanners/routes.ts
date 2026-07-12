import type {
  ApiInventoryEntry,
  Finding,
  InternalScanContext,
} from "../src/types.js";
import { makeFinding, readText } from "./util.js";

const SENSITIVE_HINTS = [
  "login",
  "signin",
  "register",
  "signup",
  "password",
  "reset",
  "otp",
  "token",
  "auth",
  "admin",
  "upload",
  "payment",
  "billing",
  "invite",
  "webhook",
  "export",
];

const AUTH_TOKENS =
  /\b(authenticate|requireauth|isauthenticated|ensureloggedin|passport|verifytoken|authmiddleware|requireuser|protect|jwt|authguard|withauth)\b/i;
const RATELIMIT_TOKENS =
  /\b(ratelimit|ratelimiter|rate_limit|limiter|throttle|slowdown|rate-limit)\b/i;
const VALIDATION_TOKENS =
  /\b(validate|validation|zod|joi|celebrate|yup|checkschema|body\(|param\(|query\(|\.parse\()\b/i;

/** Detects a boolean control on the exact route-registration line. */
function detect(line: string, re: RegExp): boolean | null {
  return re.test(line) ? true : null;
}

function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SENSITIVE_HINTS.some((h) => lower.includes(h));
}

/**
 * Builds the enriched API inventory from discovered endpoints. Controls are
 * only asserted `true` when visible on the route line; otherwise `null`
 * (needs verification) — never a false negative dressed up as a fact.
 */
export function buildApiInventory(ctx: InternalScanContext): ApiInventoryEntry[] {
  const inventory: ApiInventoryEntry[] = [];
  // Group endpoints by file so each file is read once.
  const byFile = new Map<string, typeof ctx.discovery.apiEndpoints>();
  for (const ep of ctx.discovery.apiEndpoints) {
    const arr = byFile.get(ep.file) ?? [];
    arr.push(ep);
    byFile.set(ep.file, arr);
  }

  for (const [file, endpoints] of byFile) {
    const lines = readText(ctx, file).split(/\r?\n/);
    for (const ep of endpoints) {
      const line = lines[ep.line - 1] ?? "";
      inventory.push({
        method: ep.method,
        path: ep.path,
        file: ep.file,
        line: ep.line,
        authRequired: detect(line, AUTH_TOKENS),
        authorizationChecked: detect(line, AUTH_TOKENS),
        rateLimited: detect(line, RATELIMIT_TOKENS),
        inputValidated: detect(line, VALIDATION_TOKENS),
        sensitive: isSensitivePath(ep.path),
        notes: "Controls detected lexically on the route line; verify in context.",
      });
    }
  }
  return inventory;
}

export const routesScanner = {
  name: "routes",
  description: "API route inventory and sensitive-endpoint control gaps.",
  run(ctx: InternalScanContext): Finding[] {
    const inventory = buildApiInventory(ctx);
    const findings: Finding[] = [];
    let n = 0;

    for (const e of inventory) {
      if (!e.sensitive) continue;
      const endpoint = `${e.method} ${e.path}`;
      if (e.authRequired !== true) {
        findings.push(
          makeFinding("API", ++n, {
            title: `Sensitive endpoint may lack authentication: ${endpoint}`,
            severity: "high",
            category: "api-security",
            status: "potential",
            confidence: 45,
            file: e.file,
            line: e.line,
            endpoint,
            description:
              "A sensitive endpoint has no authentication middleware visible on its route definition.",
            evidence: `${e.file}:${e.line}`,
            impact: "Unauthenticated access to a sensitive operation.",
            triggerCondition: "Direct request to the endpoint without credentials.",
            recommendedFix:
              "Verify and apply authentication/authorization middleware to this route.",
            source: "scanner:routes",
          }),
        );
      }
      if (e.rateLimited !== true) {
        findings.push(
          makeFinding("API", ++n, {
            title: `Sensitive endpoint may lack rate limiting: ${endpoint}`,
            severity: "medium",
            category: "rate-limiting",
            status: "potential",
            confidence: 45,
            file: e.file,
            line: e.line,
            endpoint,
            description:
              "No rate-limit middleware is visible on this sensitive route.",
            evidence: `${e.file}:${e.line}`,
            impact: "Brute-force / abuse of a sensitive operation.",
            recommendedFix: "Apply a distributed rate limiter keyed on user + client.",
            source: "scanner:routes",
          }),
        );
      }
    }
    return findings;
  },
};
