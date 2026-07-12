import { describe, it, expect, afterEach } from "vitest";
import { discover, walkRepo, extractApiEndpoints } from "../src/discovery.js";
import { defaultConfig } from "../src/config.js";
import { makeTempRepo, cleanup } from "./helpers.js";

let repos: string[] = [];
afterEach(() => {
  for (const r of repos) cleanup(r);
  repos = [];
});

function repo(files: Record<string, string>): string {
  const r = makeTempRepo(files);
  repos.push(r);
  return r;
}

describe("discover", () => {
  it("detects a Node/Express API repo", () => {
    const root = repo({
      "package.json": JSON.stringify({
        dependencies: { express: "^4.18.0" },
        devDependencies: { vitest: "^2.0.0" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "src/routes/auth.ts":
        "router.post('/api/login', (req, res) => {})\n" +
        "app.get('/api/users/:id', handler)\n",
    });

    const d = discover(root, defaultConfig());
    expect(d.languages).toContain("TypeScript");
    expect(d.packageManagers).toContain("pnpm");
    expect(d.frameworks).toContain("Express");
    expect(d.apiFrameworks).toContain("Express");
    expect(d.testFrameworks).toContain("Vitest");
    expect(d.dependencyFiles).toContain("package.json");
    expect(d.authFiles.some((f) => f.includes("auth"))).toBe(true);

    const methods = d.apiEndpoints.map((e) => `${e.method} ${e.path}`);
    expect(methods).toContain("POST /api/login");
    expect(methods).toContain("GET /api/users/:id");
  });

  it("detects a Python FastAPI repo", () => {
    const root = repo({
      "requirements.txt": "fastapi==0.110.0\npytest==8.0.0\n",
      "app/main.py": "from fastapi import FastAPI\n",
    });
    const d = discover(root, defaultConfig());
    expect(d.languages).toContain("Python");
    expect(d.apiFrameworks).toContain("FastAPI");
    expect(d.testFrameworks).toContain("pytest");
    expect(d.packageManagers).toContain("pip");
  });

  it("handles an unsupported/empty repo gracefully", () => {
    const root = repo({ "notes.txt": "hello" });
    const d = discover(root, defaultConfig());
    expect(d.languages).toEqual([]);
    expect(d.apiEndpoints).toEqual([]);
    expect(d.fileCount).toBe(1);
  });

  it("throws for a non-existent path", () => {
    expect(() => discover("/definitely/not/here/xyz", defaultConfig())).toThrow();
  });

  it("respects the ignore list", () => {
    const root = repo({
      "package.json": "{}",
      "node_modules/dep/index.js": "app.get('/leak', h)",
    });
    const { files } = walkRepo(root, defaultConfig().exclude, 1000);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("infers npm from package.json when no lockfile is present", () => {
    const root = repo({ "package.json": JSON.stringify({ name: "x" }) });
    const d = discover(root, defaultConfig());
    expect(d.packageManagers).toContain("npm");
  });

  it("does not add npm when a pnpm lockfile is present", () => {
    const root = repo({
      "package.json": JSON.stringify({ name: "x" }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    });
    const d = discover(root, defaultConfig());
    expect(d.packageManagers).toContain("pnpm");
    expect(d.packageManagers).not.toContain("npm");
  });

  it("detects databases and integrations from dependencies", () => {
    const root = repo({
      "package.json": JSON.stringify({
        dependencies: { pg: "^8.11.0", stripe: "^14.0.0", express: "^4.18.0" },
      }),
    });
    const d = discover(root, defaultConfig());
    expect(d.databases).toContain("PostgreSQL");
    expect(d.integrations).toContain("Stripe");
  });
});

describe("extractApiEndpoints", () => {
  it("returns real file/line references and skips test files", () => {
    const root = repo({
      "server.js": "\napp.delete('/api/item/:id', h)\n",
      "server.test.js": "app.get('/should-be-ignored', h)",
    });
    const eps = extractApiEndpoints(root, ["server.js", "server.test.js"], 100);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({
      method: "DELETE",
      path: "/api/item/:id",
      file: "server.js",
      line: 2,
    });
  });
});
