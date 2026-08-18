import { defineConfig } from "@playwright/test";

const stlstrRoot = process.env.STLSTR_ROOT ?? "/Users/gareth/git/nostrocket/SEC08/hzrd149/stlstr";
const fixtureDirectory = `${stlstrRoot}/napplets/stl-preview/dist`;

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "stlstr.spec.ts",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4174/shell/", trace: "retain-on-failure", browserName: "chromium" },
  webServer: {
    command: `VITE_INSTALL_STLSTR_FIXTURE=true VITE_STLSTR_FIXTURE_DIR=${JSON.stringify(fixtureDirectory)} pnpm --filter @platform/shell build:github && pnpm --filter @platform/shell preview:github --host 127.0.0.1 --port 4174`,
    url: "http://127.0.0.1:4174/shell/",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
