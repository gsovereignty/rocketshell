import { nip5aManifest } from "@napplet/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [nip5aManifest({
    nappletType: "navigate-problem-tree",
    title: "Navigate Problem Tree",
    description: "Navigate a NIP-1971 problem DAG and open selected problems in a note viewer.",
    requires: ["outbox", "intent"],
    artifactMode: "single-file"
  })],
  build: { modulePreload: false },
  test: { environment: "node" }
});
