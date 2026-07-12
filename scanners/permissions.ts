import type { Finding, InternalScanContext } from "../src/types.js";
import { makeFinding, readText, textFiles } from "./util.js";

const AUTHZ_TOKENS =
  /\b(authoriz|permission|can\(|ability|role|rbac|acl|isadmin|hasrole|requirerole|ownerid|owner_id|tenant|policy|gate)\b/i;

/**
 * Repo-level authorization posture. If the repo exposes protected/sensitive
 * routes but no authorization primitives appear anywhere, that is worth
 * surfacing for manual review.
 */
export const permissionsScanner = {
  name: "permissions",
  description: "Presence of authorization/ownership checks across the codebase.",
  run(ctx: InternalScanContext): Finding[] {
    const hasApi = ctx.discovery.apiFrameworks.length > 0;
    const hasEndpoints = ctx.discovery.apiEndpoints.length > 0;
    if (!hasApi && !hasEndpoints) return [];

    let authzHits = 0;
    let sampleFile: string | null = null;
    for (const rel of textFiles(ctx)) {
      const content = readText(ctx, rel);
      if (content && AUTHZ_TOKENS.test(content)) {
        authzHits++;
        sampleFile ??= rel;
      }
    }

    if (authzHits === 0) {
      return [
        makeFinding("AUTHZ", 1, {
          title: "No authorization/ownership checks detected in the codebase",
          severity: "high",
          category: "authorization",
          status: "manual-verification",
          confidence: 40,
          description:
            "The repository defines API endpoints but no authorization, role, ownership, or tenant checks were detected lexically.",
          impact:
            "Potential broken access control (IDOR, privilege escalation, missing tenant isolation).",
          triggerCondition:
            "Authenticated or unauthenticated user accessing another principal's resources.",
          recommendedFix:
            "Confirm object-level and role-based authorization is enforced on every protected route.",
          source: "scanner:permissions",
        }),
      ];
    }
    return [];
  },
};
