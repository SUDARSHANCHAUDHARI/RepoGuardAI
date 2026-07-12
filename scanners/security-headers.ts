import type { Finding, InternalScanContext } from "../src/types.js";
import { makeFinding, readText, textFiles } from "./util.js";

const HEADER_MECHANISMS =
  /\b(helmet|contentSecurityPolicy|Strict-Transport-Security|X-Content-Type-Options|X-Frame-Options|secureHeaders|@fastify\/helmet|setHeader\(['"]X-)/i;

const NODE_HTTP_FRAMEWORKS = ["Express", "Fastify", "Koa", "NestJS", "Hapi"];

/**
 * For Node HTTP frameworks, flags the apparent absence of any security-header
 * mechanism (helmet or manual header hardening). Best-effort; the agent must
 * confirm headers aren't set at a proxy/CDN layer.
 */
export const securityHeadersScanner = {
  name: "security-headers",
  description: "Presence of HTTP security headers / helmet in Node HTTP apps.",
  run(ctx: InternalScanContext): Finding[] {
    const usesNodeHttp = ctx.discovery.apiFrameworks.some((f) =>
      NODE_HTTP_FRAMEWORKS.some((k) => f.includes(k)),
    );
    if (!usesNodeHttp) return [];

    for (const rel of textFiles(ctx)) {
      const content = readText(ctx, rel);
      if (content && HEADER_MECHANISMS.test(content)) {
        return []; // some mechanism found — no finding
      }
    }

    return [
      makeFinding("HDR", 1, {
        title: "No HTTP security-header mechanism detected",
        severity: "medium",
        category: "security",
        status: "potential",
        confidence: 50,
        description:
          "A Node HTTP framework is in use but no helmet/manual security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options) were detected.",
        impact:
          "Missing headers weaken defenses against clickjacking, MIME sniffing, and downgrade attacks.",
        recommendedFix:
          "Add helmet (or equivalent) and set CSP/HSTS/X-Frame-Options; or confirm they are set at the proxy/CDN.",
        source: "scanner:security-headers",
      }),
    ];
  },
};
