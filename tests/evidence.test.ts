import { describe, it, expect, afterEach } from "vitest";
import { discover } from "../src/discovery.js";
import { collectEvidence } from "../src/evidence-collector.js";
import { defaultConfig } from "../src/config.js";
import { findingSchema } from "../src/schemas.js";
import { makeTempRepo, cleanup } from "./helpers.js";

let repos: string[] = [];
afterEach(() => {
  for (const r of repos) cleanup(r);
  repos = [];
});

function scopedConfig() {
  // Gate all EXTERNAL scanners off so the test never depends on host tools.
  const cfg = defaultConfig();
  cfg.audit.security = false;
  cfg.audit.dependencies = false;
  return cfg;
}

// Built at runtime so no literal cloud key appears in this source file.
const FAKE_AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP";

describe("collectEvidence", () => {
  it("runs in-house scanners and builds the API inventory", () => {
    const root = makeTempRepo({
      "package.json": JSON.stringify({ dependencies: { express: "^4.18.0" } }),
      "config.js": `const secret = "${FAKE_AWS_KEY}";\nmodule.exports = { secret };\n`,
      "src/routes/auth.ts": "router.post('/api/login', (req, res) => res.end())\n",
    });
    repos.push(root);

    const config = scopedConfig();
    const discovery = discover(root, config);
    const evidence = collectEvidence(root, discovery, config);

    // External scanners were gated off, not run.
    expect(
      evidence.externalScans.results.every((r) => r.status === "skipped-disabled"),
    ).toBe(true);

    // In-house scanners produced schema-valid seed findings.
    expect(evidence.seedFindings.length).toBeGreaterThan(0);
    for (const f of evidence.seedFindings) {
      expect(findingSchema.safeParse(f).success).toBe(true);
      expect(f.status).not.toBe("confirmed"); // never asserts confirmed
    }

    // Secret detected.
    const secret = evidence.seedFindings.find((f) => f.category === "secrets");
    expect(secret).toBeDefined();
    expect(secret!.source).toBe("scanner:secrets");
    expect(secret!.file).toBe("config.js");

    // API inventory row for the sensitive login endpoint.
    const login = evidence.apiInventory.find((e) => e.path === "/api/login");
    expect(login).toBeDefined();
    expect(login!.sensitive).toBe(true);
    expect(login!.authRequired).toBeNull(); // no auth visible on the line

    // A dependency finding for the missing lockfile.
    expect(evidence.seedFindings.some((f) => f.category === "dependency")).toBe(true);
  });

  it("ignores placeholder secrets", () => {
    const root = makeTempRepo({
      ".env.example": 'API_KEY="your-api-key-here"\n',
    });
    repos.push(root);
    const config = scopedConfig();
    const discovery = discover(root, config);
    const evidence = collectEvidence(root, discovery, config);
    expect(evidence.seedFindings.some((f) => f.category === "secrets")).toBe(false);
  });
});
