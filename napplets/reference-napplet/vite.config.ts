import { nip5aManifest } from "@napplet/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [nip5aManifest({
    nappletType: "reference-napplet",
    title: "Reference Napplet",
    description: "Minimal built-in napplet and host compatibility reference.",
    requires: ["identity"],
    artifactMode: "single-file"
  })],
  build: { modulePreload: false }
});
