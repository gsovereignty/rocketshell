import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "shell.spec.ts",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173/rocketshell/", trace: "retain-on-failure" },
  webServer: {
    // Blossom servers are no longer a build-time env var: the upload spec seeds the settings store instead.
    command: "VITE_INSTALL_FIXTURE=true pnpm --filter @platform/shell build:github && PLATFORM_TEST_BLOSSOM=true pnpm --filter @platform/shell preview:github --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/rocketshell/",
    reuseExistingServer: false,
    // GitHub's shared runners can spend more than two minutes bundling the shell and packaged Napplets.
    timeout: 300_000
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } }
  ]
});
