import { defineConfig } from "tsup";

const cliBanner =
  "#!/usr/bin/env node\nimport { createRequire as __rgCreateRequire } from 'module';\nconst require = __rgCreateRequire(import.meta.url);";

export default defineConfig([
  {
    entry: ["src/cli.ts", "src/index.ts"],
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist",
    clean: true,
    dts: true,
    sourcemap: true,
    splitting: false,
    // Bundle runtime deps so the built CLI is self-contained and works when
    // symlinked onto PATH and run from any directory (no node_modules needed).
    noExternal: ["commander", "yaml", "zod"],
    banner: { js: cliBanner },
  },
  {
    entry: { action: "src/action.ts" },
    format: ["esm"],
    target: "node24",
    platform: "node",
    outDir: "action-dist",
    clean: true,
    dts: false,
    sourcemap: false,
    splitting: false,
    noExternal: ["commander", "yaml", "zod"],
  },
]);
