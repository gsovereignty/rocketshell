import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { verifyEvent } from "nostr-tools/pure";
import { builtInNapplets } from "./vite.napplets.js";

const devServiceWorker = (): Plugin => ({
  name: "platform-dev-service-worker",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      const workerPath = `${server.config.base}service-worker.js`.replace(/\/+/g, "/");
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
        response.end(transformed.code);
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
      if (pathname !== "/shell/resource-test.png") { next(); return; }
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain");
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });
  }
});

export default defineConfig(({ mode }) => {
  return {
    base: mode === "github" ? "/shell/" : process.env.PLATFORM_BASE ?? "/",
    plugins: [devServiceWorker(), testBlossomServer(), testResourceServer(), builtInNapplets(resolve(__dirname, "../.."))],
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
