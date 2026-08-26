import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(repositoryRoot),
      "server-only": path.resolve(repositoryRoot, "test-stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
