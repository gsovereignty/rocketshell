import { nip5aManifest } from "@napplet/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [nip5aManifest({
    nappletType: "view-problem",
    title: "View Problem",
    description: "View, claim, discuss, and follow one NIP-1971 problem.",
    requires: ["identity", "outbox", "intent"],
    artifactMode: "single-file"
  })],
  build: { modulePreload: false },
  test: { environment: "node" }
});
