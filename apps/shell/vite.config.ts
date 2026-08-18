import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "github" ? "/shell/" : process.env.PLATFORM_BASE ?? "/",
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
