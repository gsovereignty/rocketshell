import { describe, expect, it } from "vitest";
import { isRuntimeArtifact } from "./vite.napplets";

describe("built-in Napplet artifacts", () => {
  it("excludes the local NIP-5A manifest sidecar", () => {
    expect(isRuntimeArtifact(".nip5a-manifest.json")).toBe(false);
    expect(isRuntimeArtifact("index.html")).toBe(true);
  });
});
