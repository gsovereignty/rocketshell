import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173/shell/", trace: "retain-on-failure" },
  webServer: {
    command: "VITE_INSTALL_FIXTURE=true pnpm --filter @platform/shell build:github && pnpm --filter @platform/shell preview:github --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/shell/",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } }
  ]
});
