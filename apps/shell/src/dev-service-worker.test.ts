import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { currentDevBuildId, devServiceWorker } from "../vite.config.js";

describe("development service-worker identity", () => {
  it("reads current build identity for every request without restarting Vite", async () => {
    const root = mkdtempSync(join(tmpdir(), "worker-build-id-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    for (const directory of ["apps/shell/src", "packages/napplet-gateway/src", "napplets/alpha/dist"]) mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, "apps/shell/src/main.ts"), "export {};");
    writeFileSync(join(root, "packages/napplet-gateway/src/index.ts"), "export {};");
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 6");
    writeFileSync(join(root, "napplets/alpha/package.json"), JSON.stringify({ name: "alpha", napplet: { dTag: "alpha", requires: [] } }));
    const artifact = join(root, "napplets/alpha/dist/index.html");
    writeFileSync(artifact, "<main>build A</main>");
    let middleware: ((request: any, response: any, next: (error?: Error) => void) => Promise<void>) | undefined;
    const plugin = devServiceWorker(() => currentDevBuildId(root));
    const server = {
      config: { base: "/" },
      middlewares: { use: vi.fn((handler) => { middleware = handler; }) },
      transformRequest: vi.fn(async () => ({ code: "const id = __SHELL_BUILD_ID__;" }))
    };
    (plugin.configureServer as Function)(server);

    const request = async (url: string): Promise<string> => {
      let body = "";
      await middleware!({ url }, {
        set statusCode(_value: number) {},
        setHeader: vi.fn(),
        end: (value: string) => { body = value; }
      }, vi.fn());
      return body;
    };

    const identityA = JSON.parse(await request("/shell-build-id.json")).buildId as string;
    expect(await request(`/service-worker.js?build=${identityA}`)).toContain(JSON.stringify(identityA));

    writeFileSync(artifact, "<main>build B</main>");
    const identityB = JSON.parse(await request("/shell-build-id.json")).buildId as string;
    expect(identityB).not.toBe(identityA);
    expect(await request(`/service-worker.js?build=${identityB}`)).toContain(JSON.stringify(identityB));
  });
});
