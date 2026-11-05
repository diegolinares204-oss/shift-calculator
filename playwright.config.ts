import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    acceptDownloads: true,
    serviceWorkers: "block",
  },
  webServer: {
    // requiere `npm run build` previo (sirve la carpeta out/)
    command: `node scripts/serve-static.mjs`,
    env: { PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: true,
  },
  projects: [
    { name: "movil", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "escritorio", use: { viewport: { width: 1366, height: 860 } } },
  ],
});
