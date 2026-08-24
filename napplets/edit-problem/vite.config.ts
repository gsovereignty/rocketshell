import { nip5aManifest } from "@napplet/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  resolve: { conditions: ["source"] },
  plugins: [nip5aManifest({
    nappletType: "edit-problem",
    title: "Edit Problem",
    description: "Edit and publish a NIP-1971 problem revision.",
    requires: ["identity", "outbox", "intent", "inc", "upload"],
    archetypes: [{ slug: "composer", convention: "napplet:composer/problem-edit" }],
    artifactMode: "single-file"
  })],
  build: { modulePreload: false },
  test: { environment: "node" }
});
