import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import type { InstallationRecord, SignedManifest, StoredArtifact } from "@platform/napplet-gateway";
import { dockLauncherFromManifest } from "./dock-launchers.js";

const event = (tags: string[][]): SignedManifest => ({
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1,
  kind: 35129,
  tags,
  content: "",
  sig: "c".repeat(128)
});

const favicon = (path = "favicon.svg", mediaType = "image/svg+xml"): StoredArtifact => ({
  path,
  mediaType,
  sha256: "e".repeat(64),
  bytes: new Uint8Array()
});

const html = (content: string, path = "index.html"): StoredArtifact => ({
  path,
  mediaType: "text/html",
  sha256: "f".repeat(64),
  bytes: new TextEncoder().encode(content)
});

const installation = (tags: string[][], artifacts: StoredArtifact[] = [favicon()]): InstallationRecord => ({
  installationId: "installation",
  dTag: "example-napplet",
  aggregateHash: "d".repeat(64),
  manifestEvent: event(tags),
  manifest: {
    dTag: "example-napplet",
    title: "Manifest content title",
    aggregateHash: "d".repeat(64),
    entrypoint: "index.html",
    requires: [],
    artifacts
  },
  namespacePrelude: "",
  artifacts,
  committedAt: 1
});

const relays = ["wss://relay.example"];

describe("dock launcher manifest metadata", () => {
  it("builds launcher coordinate from installed signed manifest", () => {
    const launcher = dockLauncherFromManifest(installation([]), relays, "/shell/")!;
    const decoded = nip19.decode(launcher.coordinate);
    expect(decoded.type).toBe("naddr");
    if (decoded.type !== "naddr") return;
    expect(decoded.data).toMatchObject({
      kind: 35129,
      identifier: "example-napplet",
      pubkey: "b".repeat(64),
      relays
    });
  });

  it("uses signed title and verified packaged favicon", () => {
    expect(dockLauncherFromManifest(installation([
      ["title", "Discover prints"]
    ]), relays, "/shell/")).toMatchObject({
      dTag: "example-napplet",
      title: "Discover prints",
      iconUrl: `/shell/__napplet__/example-napplet/${"d".repeat(64)}/favicon.svg`,
      initial: "D"
    });
  });

  it("uses first title letter when no favicon is packaged", () => {
    const launcher = dockLauncherFromManifest(installation([], []), relays, "/");
    expect(launcher).toMatchObject({ initial: "M" });
    expect(launcher).not.toHaveProperty("iconUrl");
  });

  it("accepts only packaged image favicon artifacts", () => {
    expect(dockLauncherFromManifest(installation([], [favicon("favicon.txt", "text/plain")]), relays, "/"))
      .not.toHaveProperty("iconUrl");
    expect(dockLauncherFromManifest(installation([], [favicon("favicon.ico", "image/x-icon")]), relays, "/")?.iconUrl)
      .toContain("/favicon.ico");
  });

  it("uses an embedded favicon from the verified entrypoint", () => {
    const icon = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
    const launcher = dockLauncherFromManifest(installation([], [
      html(`<html><head><link href="${icon}" rel="shortcut icon"></head></html>`)
    ]), relays, "/shell/");
    expect(launcher.iconUrl).toBe(icon);
  });

  it("resolves an entrypoint favicon only when it is a packaged image", () => {
    const launcher = dockLauncherFromManifest(installation([], [
      html('<link rel="icon" href="./assets/app.png?v=1">'),
      favicon("assets/app.png", "image/png")
    ]), relays, "/shell/");
    expect(launcher.iconUrl).toBe(`/shell/__napplet__/example-napplet/${"d".repeat(64)}/assets/app.png`);

    expect(dockLauncherFromManifest(installation([], [
      html('<link rel="icon" href="https://outside.example/icon.png">')
    ]), relays, "/shell/")).not.toHaveProperty("iconUrl");
  });
});
