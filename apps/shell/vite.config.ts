import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

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

export default defineConfig(({ mode }) => ({
  base: mode === "github" ? "/shell/" : process.env.PLATFORM_BASE ?? "/",
  plugins: [devServiceWorker()],
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
}));
