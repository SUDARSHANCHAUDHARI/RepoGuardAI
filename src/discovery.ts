import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { discoverySchema } from "./schemas.js";
import { walkExcludes } from "./config.js";
import type { ApiEndpoint, Discovery, RepoGuardConfig } from "./types.js";

/** Map of file extension -> language name. */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++",
  ".scala": "Scala",
  ".ex": "Elixir",
  ".exs": "Elixir",
};

/** Filename -> package manager. */
const PACKAGE_MANAGER_BY_FILE: Record<string, string> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
  "requirements.txt": "pip",
  "poetry.lock": "poetry",
  "pyproject.toml": "pip/poetry",
  "Pipfile": "pipenv",
  "go.mod": "go-modules",
  "Cargo.toml": "cargo",
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "Gemfile": "bundler",
  "composer.json": "composer",
};

/** Filenames that are dependency manifests. */
const DEPENDENCY_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "Pipfile.lock",
  "poetry.lock",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
]);

/** node package name -> framework label, grouped by concern. */
const NODE_API_FRAMEWORKS: Record<string, string> = {
  express: "Express",
  fastify: "Fastify",
  koa: "Koa",
  "@nestjs/core": "NestJS",
  "@hapi/hapi": "Hapi",
  "apollo-server": "Apollo GraphQL",
  "@apollo/server": "Apollo GraphQL",
  graphql: "GraphQL",
  "next": "Next.js (API routes)",
  hono: "Hono",
};

const NODE_FRAMEWORKS: Record<string, string> = {
  react: "React",
  vue: "Vue",
  "@angular/core": "Angular",
  svelte: "Svelte",
  next: "Next.js",
  nuxt: "Nuxt",
  ...NODE_API_FRAMEWORKS,
};

const NODE_TEST_FRAMEWORKS: Record<string, string> = {
  vitest: "Vitest",
  jest: "Jest",
  mocha: "Mocha",
  "@playwright/test": "Playwright",
  cypress: "Cypress",
  ava: "AVA",
};

/** Substrings in a file's relative path that flag auth-related code. */
const AUTH_PATH_HINTS = [
  "auth",
  "login",
  "session",
  "jwt",
  "passport",
  "oauth",
  "permission",
  "authorize",
  "middleware/auth",
];

interface WalkResult {
  files: string[]; // repo-relative paths
  truncated: boolean;
}

/** Recursively lists repo files, honouring the ignore list and a hard cap. */
export function walkRepo(
  repoRoot: string,
  ignore: string[],
  maxFiles: number,
): WalkResult {
  const ignoreSet = new Set(ignore);
  const files: string[] = [];
  let truncated = false;

  const stack: string[] = [repoRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, broken symlink) — skip gracefully.
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && ignoreSet.has(entry.name)) continue;
      if (ignoreSet.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          return { files, truncated };
        }
        files.push(relative(repoRoot, full));
      }
    }
  }
  return { files, truncated };
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectNodeDeps(repoRoot: string, files: string[]): Set<string> {
  const deps = new Set<string>();
  for (const rel of files) {
    if (basename(rel) !== "package.json") continue;
    const pkg = readJsonSafe(join(repoRoot, rel));
    if (!pkg) continue;
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = pkg[key];
      if (block && typeof block === "object") {
        for (const dep of Object.keys(block as Record<string, unknown>)) {
          deps.add(dep);
        }
      }
    }
  }
  return deps;
}

/** Detects languages from present file extensions. */
function detectLanguages(files: string[]): string[] {
  const langs = new Set<string>();
  for (const f of files) {
    const lang = LANGUAGE_BY_EXT[extname(f).toLowerCase()];
    if (lang) langs.add(lang);
  }
  return [...langs].sort();
}

function detectPackageManagers(files: string[]): string[] {
  const managers = new Set<string>();
  for (const f of files) {
    const pm = PACKAGE_MANAGER_BY_FILE[basename(f)];
    if (pm) managers.add(pm);
  }
  return [...managers].sort();
}

function filterExisting(files: string[], predicate: (rel: string) => boolean) {
  return files.filter(predicate).sort();
}

/**
 * Best-effort API route inventory for common Node frameworks. This is a
 * lexical scan — it never executes code and only reports what it can see.
 * Findings are marked in the discovery output as evidence, not proof.
 */
export function extractApiEndpoints(
  repoRoot: string,
  files: string[],
  maxScanFiles: number,
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const routeRegex =
    /\b(?:app|router|route|api|server|fastify)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;

  const candidates = files
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(f))
    .filter((f) => !/\.(test|spec)\./i.test(f))
    .slice(0, maxScanFiles);

  for (const rel of candidates) {
    let content: string;
    try {
      content = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      routeRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = routeRegex.exec(line)) !== null) {
        endpoints.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          file: rel,
          line: i + 1,
        });
      }
    }
  }
  return endpoints;
}

/**
 * Runs discovery over a repository and returns a schema-validated result.
 * Throws only for unrecoverable issues (e.g. repoRoot does not exist).
 */
export function discover(
  repoRoot: string,
  config: RepoGuardConfig,
): Discovery {
  let rootStat: import("node:fs").Stats;
  try {
    rootStat = statSync(repoRoot);
  } catch {
    throw new Error(`Repository path does not exist: ${repoRoot}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repoRoot}`);
  }

  const { files } = walkRepo(
    repoRoot,
    walkExcludes(config),
    config.discovery.maxFiles,
  );

  const nodeDeps = collectNodeDeps(repoRoot, files);

  const frameworks = new Set<string>();
  const apiFrameworks = new Set<string>();
  const testFrameworks = new Set<string>();

  for (const [dep, label] of Object.entries(NODE_FRAMEWORKS)) {
    if (nodeDeps.has(dep)) frameworks.add(label);
  }
  for (const [dep, label] of Object.entries(NODE_API_FRAMEWORKS)) {
    if (nodeDeps.has(dep)) apiFrameworks.add(label);
  }
  for (const [dep, label] of Object.entries(NODE_TEST_FRAMEWORKS)) {
    if (nodeDeps.has(dep)) testFrameworks.add(label);
  }

  // Non-node framework/test detection by manifest content.
  detectNonNodeStacks(repoRoot, files, frameworks, apiFrameworks, testFrameworks);

  const ciWorkflows = filterExisting(
    files,
    (f) =>
      f.startsWith(".github/workflows/") ||
      f === ".gitlab-ci.yml" ||
      f.startsWith(".circleci/") ||
      f === "Jenkinsfile" ||
      f === "azure-pipelines.yml" ||
      f.startsWith(".azure-pipelines/"),
  );

  const infraFiles = filterExisting(files, (f) => {
    const base = basename(f);
    return (
      base === "Dockerfile" ||
      base.startsWith("Dockerfile.") ||
      base === "docker-compose.yml" ||
      base === "docker-compose.yaml" ||
      f.endsWith(".tf") ||
      f.endsWith(".tfvars") ||
      f.includes("k8s/") ||
      f.includes("kubernetes/") ||
      f.includes("helm/") ||
      base === "Chart.yaml"
    );
  });

  const authFiles = filterExisting(files, (f) => {
    const lower = f.toLowerCase();
    if (/\.(ts|tsx|js|jsx|py|go|rb|java|kt|php|cs|rs)$/i.test(f) === false) {
      return false;
    }
    return AUTH_PATH_HINTS.some((h) => lower.includes(h));
  });

  const configFiles = filterExisting(files, (f) => {
    const base = basename(f);
    return (
      base.startsWith(".env") ||
      /\.(ya?ml|toml|ini|cfg|conf|properties)$/i.test(base) ||
      base === "config.json" ||
      base.endsWith(".config.js") ||
      base.endsWith(".config.ts")
    );
  });

  const dependencyFiles = filterExisting(files, (f) =>
    DEPENDENCY_FILES.has(basename(f)),
  );

  const apiEndpoints = extractApiEndpoints(
    repoRoot,
    files,
    config.discovery.maxEndpointScanFiles,
  );

  const { databases, integrations } = detectDataStoresAndIntegrations(
    repoRoot,
    files,
    nodeDeps,
  );

  const discovery: Discovery = {
    repository: repoRoot,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    languages: detectLanguages(files),
    frameworks: [...frameworks].sort(),
    packageManagers: detectPackageManagers(files),
    dependencyFiles,
    apiFrameworks: [...apiFrameworks].sort(),
    testFrameworks: [...testFrameworks].sort(),
    databases,
    integrations,
    ciWorkflows,
    infraFiles,
    authFiles,
    configFiles,
    apiEndpoints,
  };

  // Validate before returning so callers can trust the shape.
  return discoverySchema.parse(discovery);
}

/** Keyword -> label maps for datastore and third-party integration detection. */
const DATABASE_KEYWORDS: Record<string, string> = {
  pg: "PostgreSQL",
  postgres: "PostgreSQL",
  psycopg2: "PostgreSQL",
  mysql: "MySQL",
  mysql2: "MySQL",
  mongodb: "MongoDB",
  mongoose: "MongoDB",
  pymongo: "MongoDB",
  redis: "Redis",
  ioredis: "Redis",
  sqlite: "SQLite",
  "better-sqlite3": "SQLite",
  prisma: "Prisma ORM",
  typeorm: "TypeORM",
  sequelize: "Sequelize",
  knex: "Knex",
  sqlalchemy: "SQLAlchemy",
  gorm: "GORM",
  cassandra: "Cassandra",
  dynamodb: "DynamoDB",
  elasticsearch: "Elasticsearch",
};

const INTEGRATION_KEYWORDS: Record<string, string> = {
  stripe: "Stripe",
  "aws-sdk": "AWS SDK",
  "@aws-sdk": "AWS SDK",
  boto3: "AWS SDK",
  "@sendgrid": "SendGrid",
  twilio: "Twilio",
  firebase: "Firebase",
  "firebase-admin": "Firebase",
  "@supabase": "Supabase",
  openai: "OpenAI",
  "@anthropic-ai": "Anthropic",
  googleapis: "Google APIs",
  nodemailer: "Nodemailer",
  amqplib: "RabbitMQ",
  kafkajs: "Kafka",
  bull: "BullMQ",
  "@sentry": "Sentry",
};

/** Detects databases and third-party integrations from deps + manifests. */
function detectDataStoresAndIntegrations(
  repoRoot: string,
  files: string[],
  nodeDeps: Set<string>,
): { databases: string[]; integrations: string[] } {
  // Blob of dependency-manifest text for non-node keyword matching.
  let blob = "";
  for (const rel of files) {
    const base = basename(rel);
    if (
      ["requirements.txt", "pyproject.toml", "Pipfile", "go.mod", "Cargo.toml", "composer.json"].includes(
        base,
      )
    ) {
      try {
        blob += readFileSync(join(repoRoot, rel), "utf8").toLowerCase() + "\n";
      } catch {
        /* ignore */
      }
    }
  }

  const match = (map: Record<string, string>): string[] => {
    const found = new Set<string>();
    for (const [kw, label] of Object.entries(map)) {
      if (nodeDeps.has(kw) || [...nodeDeps].some((d) => d.startsWith(kw))) {
        found.add(label);
      } else if (blob.includes(kw)) {
        found.add(label);
      }
    }
    return [...found].sort();
  };

  return { databases: match(DATABASE_KEYWORDS), integrations: match(INTEGRATION_KEYWORDS) };
}

/** Detects frameworks/test tools that are not expressed as npm deps. */
function detectNonNodeStacks(
  repoRoot: string,
  files: string[],
  frameworks: Set<string>,
  apiFrameworks: Set<string>,
  testFrameworks: Set<string>,
): void {
  const has = (name: string) => files.some((f) => basename(f) === name);

  // Python
  const pyManifests = files.filter((f) =>
    ["requirements.txt", "pyproject.toml", "Pipfile"].includes(basename(f)),
  );
  for (const rel of pyManifests) {
    let content = "";
    try {
      content = readFileSync(join(repoRoot, rel), "utf8").toLowerCase();
    } catch {
      continue;
    }
    if (content.includes("django")) {
      frameworks.add("Django");
      apiFrameworks.add("Django");
    }
    if (content.includes("flask")) {
      frameworks.add("Flask");
      apiFrameworks.add("Flask");
    }
    if (content.includes("fastapi")) {
      frameworks.add("FastAPI");
      apiFrameworks.add("FastAPI");
    }
    if (content.includes("pytest")) testFrameworks.add("pytest");
  }
  if (files.some((f) => /(^|\/)test_.*\.py$/.test(f))) {
    testFrameworks.add("pytest");
  }

  // Go
  if (has("go.mod")) {
    const goMod = files.find((f) => basename(f) === "go.mod");
    if (goMod) {
      let content = "";
      try {
        content = readFileSync(join(repoRoot, goMod), "utf8");
      } catch {
        /* ignore */
      }
      if (content.includes("gin-gonic/gin")) apiFrameworks.add("Gin");
      if (content.includes("labstack/echo")) apiFrameworks.add("Echo");
      if (content.includes("gofiber/fiber")) apiFrameworks.add("Fiber");
    }
    if (files.some((f) => f.endsWith("_test.go"))) {
      testFrameworks.add("go test");
    }
  }

  // Rust
  if (has("Cargo.toml")) {
    const cargo = files.find((f) => basename(f) === "Cargo.toml");
    if (cargo) {
      let content = "";
      try {
        content = readFileSync(join(repoRoot, cargo), "utf8").toLowerCase();
      } catch {
        /* ignore */
      }
      if (content.includes("actix-web")) apiFrameworks.add("Actix Web");
      if (content.includes("axum")) apiFrameworks.add("Axum");
      if (content.includes("rocket")) apiFrameworks.add("Rocket");
    }
    testFrameworks.add("cargo test");
  }
}
