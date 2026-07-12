import type { Finding, InternalScanContext } from "../src/types.js";
import { secretsScanner } from "./secrets.js";
import { dependenciesScanner } from "./dependencies.js";
import { routesScanner, buildApiInventory } from "./routes.js";
import { permissionsScanner } from "./permissions.js";
import { configurationScanner } from "./configuration.js";
import { securityHeadersScanner } from "./security-headers.js";

export interface InternalScanner {
  name: string;
  description: string;
  run(ctx: InternalScanContext): Finding[];
}

/** All in-house deterministic scanners, in execution order. */
export const INTERNAL_SCANNERS: InternalScanner[] = [
  secretsScanner,
  dependenciesScanner,
  routesScanner,
  permissionsScanner,
  configurationScanner,
  securityHeadersScanner,
];

export { buildApiInventory };
