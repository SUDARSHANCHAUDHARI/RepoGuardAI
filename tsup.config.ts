import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  // Bundle runtime deps so the built CLI is self-contained and works when
  // symlinked onto PATH and run from any directory (no node_modules needed).
  noExternal: ["commander", "yaml", "zod"],
  banner: {
    // Shebang + a real `require` (via createRequire) so bundled CommonJS deps
    // that require() Node builtins work in the ESM output.
    js: "#!/usr/bin/env node\nimport { createRequire as __rgCreateRequire } from 'module';\nconst require = __rgCreateRequire(import.meta.url);",
  },
});
