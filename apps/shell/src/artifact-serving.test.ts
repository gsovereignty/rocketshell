import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer, type ViteDevServer } from "vite";
import { builtInNapplets } from "../vite.napplets.js";

const napplet = (root: string, dTag: string, body: string) => {
  const app = join(root, "napplets", dTag);
  mkdirSync(join(app, "dist"), { recursive: true });
  mkdirSync(join(app, "src"), { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: dTag, napplet: { dTag, requires: [] } }));
  writeFileSync(join(app, "src", "main.ts"), "export {};");
  const artifact = join(app, "dist", "index.html");
  writeFileSync(artifact, body);
  return artifact;
};

let server: ViteDevServer | undefined;
let http: Server | undefined;
afterEach(async () => {
  await new Promise<void>((done) => http ? http.close(() => done()) : done());
  await server?.close();
  server = undefined;
  http = undefined;
});

const start = async (root: string) => {
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "app", "index.html"), "<html></html>");
  server = await createServer({
    configFile: false,
    root: join(root, "app"),
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [builtInNapplets(root)]
  });
  const instance = server;
  http = createHttpServer(instance.middlewares);
  await new Promise<void>((listening) => http!.listen(0, "127.0.0.1", listening));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a port");
  return { instance, origin: `http://127.0.0.1:${address.port}` };
};

const get = async (origin: string, path: string) => {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: await response.text(), header: (name: string) => response.headers.get(name) };
};

it("serves the bytes currently on disk, never a cached copy", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  const artifact = napplet(root, "alpha", "<html>first</html>");
  const { origin } = await start(root);

  const first = await get(origin, "/napplets.dev/alpha/index.html");
  expect(first.body).toBe("<html>first</html>");
  expect(first.header("cache-control")).toBe("no-store");

  writeFileSync(artifact, "<html>second</html>");
  const second = await get(origin, "/napplets.dev/alpha/index.html");
  expect(second.body).toBe("<html>second</html>");
});

it("republishes hashes in the registry whenever an artifact changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  const artifact = napplet(root, "alpha", "<html>first</html>");
  const { origin } = await start(root);

  const before = await get(origin, "/napplets.dev.json");
  expect(before.header("cache-control")).toBe("no-store");
  writeFileSync(artifact, "<html>second</html>");
  const after = await get(origin, "/napplets.dev.json");

  const hash = (payload: string) => JSON.parse(payload).napplets[0].files[0].sha256 as string;
  expect(hash(after.body)).not.toBe(hash(before.body));
});

it("refuses stale registry and artifact bytes until the napplet rebuilds", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  napplet(root, "alpha", "<html>first</html>");
  const { origin } = await start(root);

  const fresh = await get(origin, "/napplets.dev.json");
  expect(fresh.header("x-napplet-stale")).toBe("none");

  const { utimesSync } = await import("node:fs");
  utimesSync(join(root, "napplets", "alpha", "src", "main.ts"), 4_000_000, 4_000_000);
  utimesSync(join(root, "napplets", "alpha", "dist", "index.html"), 1_000_000, 1_000_000);
  const stale = await get(origin, "/napplets.dev.json");
  expect(stale.status).toBe(503);
  expect(stale.header("x-napplet-stale")).toBe("alpha");
  expect(stale.body).toContain("stale-napplet-artifacts");

  const blockedArtifact = await get(origin, "/napplets.dev/alpha/index.html");
  expect(blockedArtifact.status).toBe(503);
  expect(blockedArtifact.body).not.toContain("<html>first</html>");

  writeFileSync(join(root, "napplets", "alpha", "dist", "index.html"), "<html>rebuilt</html>");
  utimesSync(join(root, "napplets", "alpha", "dist", "index.html"), 5_000_000, 5_000_000);

  const recoveredRegistry = await get(origin, "/napplets.dev.json");
  expect(recoveredRegistry.status).toBe(200);
  expect(recoveredRegistry.header("x-napplet-stale")).toBe("none");
  const recoveredArtifact = await get(origin, "/napplets.dev/alpha/index.html");
  expect(recoveredArtifact.status).toBe(200);
  expect(recoveredArtifact.body).toBe("<html>rebuilt</html>");
});

it("watches every napplet dist directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  napplet(root, "alpha", "<html>first</html>");
  napplet(root, "beta", "<html>first</html>");
  const { instance } = await start(root);
  // Keys are real paths, so compare by suffix: macOS resolves the temp root through a symlink.
  const registered = Object.keys(instance.watcher.getWatched());
  for (const dTag of ["alpha", "beta"]) {
    expect(registered.some((path) => path.endsWith(join("napplets", dTag, "dist")))).toBe(true);
  }
});

it("tells the browser to reload when a napplet artifact changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  const artifact = napplet(root, "alpha", "<html>first</html>");
  const { instance } = await start(root);
  await new Promise((settle) => setTimeout(settle, 500));
  const reloads: unknown[] = [];
  instance.hot.send = ((payload: unknown) => { reloads.push(payload); }) as typeof instance.hot.send;

  // Driven through the watcher's own event channel: this asserts the plugin's reaction,
  // not the host filesystem's event latency, which is unreliable under parallel test load.
  instance.watcher.emit("all", "change", artifact);
  await expect.poll(() => reloads.filter((payload) => (payload as { type?: string }).type === "full-reload").length, { timeout: 5_000 }).toBe(1);
});

it("ignores changes outside napplet dist directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  napplet(root, "alpha", "<html>first</html>");
  const { instance } = await start(root);
  // The fixture is written moments before the watcher starts, so let any event for it settle
  // before measuring: this test is about what the plugin filters, not about startup noise.
  await new Promise((settle) => setTimeout(settle, 500));
  const reloads: unknown[] = [];
  instance.hot.send = ((payload: unknown) => { reloads.push(payload); }) as typeof instance.hot.send;

  // Vite reloads for its own root HTML, so only a napplet-internal non-dist path is asserted here.
  instance.watcher.emit("all", "change", join(root, "napplets", "alpha", "src", "main.ts"));
  await new Promise((settle) => setTimeout(settle, 400));
  expect(reloads.filter((payload) => (payload as { type?: string }).type === "full-reload")).toEqual([]);
});

it("coalesces a multi-file rebuild into a single reload", async () => {
  const root = mkdtempSync(join(tmpdir(), "artifact-serving-"));
  const artifact = napplet(root, "alpha", "<html>first</html>");
  const { instance } = await start(root);
  await new Promise((settle) => setTimeout(settle, 500));
  const reloads: unknown[] = [];
  instance.hot.send = ((payload: unknown) => { reloads.push(payload); }) as typeof instance.hot.send;

  for (let index = 0; index < 12; index += 1) instance.watcher.emit("all", "change", artifact);
  await expect.poll(() => reloads.length, { timeout: 5_000 }).toBe(1);
});
