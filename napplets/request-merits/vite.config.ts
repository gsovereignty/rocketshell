import { nip5aManifest } from "@napplet/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [nip5aManifest({
    nappletType: "request-merits",
    title: "Request Merits",
    description: "Request merits for completed work in a Rocket.",
    requires: ["outbox", "inc", "resource"],
    archetypes: [{ slug: "composer", convention: "napplet:composer/merit-request" }],
    artifactMode: "single-file"
  })],
  build: { modulePreload: false },
  test: { environment: "node" }
});
