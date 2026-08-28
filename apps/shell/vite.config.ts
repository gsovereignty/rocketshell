import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { verifyEvent } from "nostr-tools/pure";
import { builtInNappletBuildId, builtInNapplets } from "./vite.napplets.js";

export const sourceBuildId = (repositoryRoot: string, nappletBuildId: string): string => {
  const hash = createHash("sha256").update(nappletBuildId);
  const roots = [resolve(repositoryRoot, "apps/shell/src"), resolve(repositoryRoot, "packages/napplet-gateway/src")];
  const addTree = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) addTree(path);
      else if (entry.isFile()) hash.update(path.slice(repositoryRoot.length)).update("\0").update(readFileSync(path));
    }
  };
  for (const root of roots) addTree(root);
  hash.update(readFileSync(resolve(repositoryRoot, "pnpm-lock.yaml")));
  return hash.digest("hex");
};

export const currentDevBuildId = (repositoryRoot: string): string =>
  sourceBuildId(repositoryRoot, builtInNappletBuildId(repositoryRoot));

export const devServiceWorker = (currentBuildId: () => string): Plugin => ({
  name: "platform-dev-service-worker",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      const workerPath = `${server.config.base}service-worker.js`.replace(/\/+/g, "/");
      const identityPath = `${server.config.base}shell-build-id.json`.replace(/\/+/g, "/");
      if (pathname === identityPath) {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({ buildId: currentBuildId() }));
        return;
      }
      if (pathname !== workerPath) {
        next();
        return;
      }

      try {
        const transformed = await server.transformRequest("/src/service-worker.ts");
        if (!transformed) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Service-Worker-Allowed", server.config.base);
        response.end(transformed.code.replaceAll("__SHELL_BUILD_ID__", JSON.stringify(currentBuildId())));
      } catch (error) {
        next(error as Error);
      }
    });
  }
});

const testBlossomServer = (): Plugin => ({
  name: "platform-test-blossom",
  apply: "serve",
  configurePreviewServer(server) {
    if (process.env.PLATFORM_TEST_BLOSSOM !== "true") return;
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      if (!pathname.startsWith("/mock-blossom")) { next(); return; }
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const authorization = request.headers.authorization;
          if (!authorization?.startsWith("Nostr ")) throw new Error("missing authorization");
          const event = JSON.parse(Buffer.from(authorization.slice(6), "base64").toString("utf8"));
          if (!verifyEvent(event) || event.kind !== 24242 || !event.tags.some((tag: unknown) => Array.isArray(tag) && tag[0] === "t" && tag[1] === "upload")) throw new Error("invalid authorization");
          const bytes = Buffer.concat(chunks);
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({
            url: `https://cdn.example/${event.pubkey}/uploaded.txt`,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.length,
            type: request.headers["content-type"]
          }));
        } catch {
          response.statusCode = 401; response.end("invalid Blossom authorization");
        }
      });
    });
  }
});

const testResourceServer = (): Plugin => ({
  name: "platform-test-resource",
  apply: "serve",
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      if (pathname !== "/rocketshell/resource-test.png") { next(); return; }
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain");
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });
  }
});

const testLegacyServiceWorker = (): Plugin => ({
  name: "platform-test-legacy-service-worker",
  apply: "serve",
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      const workerPath = `${server.config.base}legacy-service-worker.js`.replace(/\/+/g, "/");
      if (pathname !== workerPath) { next(); return; }
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/javascript; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Service-Worker-Allowed", server.config.base);
      response.end(`
        const CACHE = "platform-shell-legacy-test";
        self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
        self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
        self.addEventListener("fetch", event => {
          if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
          if (new URL(event.request.url).pathname.endsWith("/napplets.json")) {
            event.waitUntil(caches.open("legacy-worker-observations").then(cache =>
              cache.put("/legacy-registry-read", new Response("read"))));
          }
          event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(async response => {
            if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
            return response;
          })));
        });
      `);
    });
  }
});

export default defineConfig(({ mode }) => {
  const repositoryRoot = resolve(__dirname, "../..");
  // Built-in Napplet bytes define cache identity. Rebuilding any artifact therefore
  // produces a new worker and retires every cache that could contain old pixels.
  const currentBuildId = (): string => currentDevBuildId(repositoryRoot);
  const buildId = currentBuildId();
  return {
    define: { __SHELL_BUILD_ID__: JSON.stringify(buildId) },
    base: mode === "pages" ? "/" : mode === "github" ? "/rocketshell/" : process.env.PLATFORM_BASE ?? "/",
    plugins: [devServiceWorker(currentBuildId), testBlossomServer(), testResourceServer(), testLegacyServiceWorker(), builtInNapplets(repositoryRoot)],
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { shell: resolve(__dirname, "index.html"), "service-worker": resolve(__dirname, "src/service-worker.ts") },
        output: {
          entryFileNames: (chunk) => chunk.name === "service-worker" ? "service-worker.js" : "assets/[name]-[hash].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});
