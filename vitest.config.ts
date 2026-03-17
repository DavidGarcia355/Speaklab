import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "test-stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
  },
});
