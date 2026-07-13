import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // Workspace-Packages mitbundeln, echte Dependencies extern lassen.
  noExternal: ["@agent-team/core", "@agent-team/db", "@agent-team/shared"],
});
