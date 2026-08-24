import { nip5aManifest } from "@napplet/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [
    nip5aManifest({
      nappletType: "log-new-problem",
      title: "Log New Problem",
      description: "Create and publish NIP-1971 root and child problems.",
      requires: ["identity", "outbox", "inc", "upload", "resource"],
      archetypes: [{ slug: "composer", convention: "napplet:composer/problem-child" }],
      artifactMode: "single-file"
    })
  ],
  build: { modulePreload: false },
  test: { environment: "node" }
});
