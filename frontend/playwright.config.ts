import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the production build (run `npm run e2e`, which builds first).
const PORT = 43130;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "he-IL" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/e2e-test-token-0123456789/`,
    reuseExistingServer: false,
  },
});
