import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

process.env.TZ = "Europe/Madrid";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
