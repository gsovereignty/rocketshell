import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import type { InstallationRecord, SignedManifest } from "@platform/napplet-gateway";
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

const installation = (tags: string[][]): InstallationRecord => ({
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
    artifacts: []
  },
  namespacePrelude: "",
  artifacts: [],
  committedAt: 1
});

const relays = ["wss://relay.example"];

describe("dock launcher manifest metadata", () => {
  it("builds launcher coordinate from installed signed manifest", () => {
    const launcher = dockLauncherFromManifest(installation([
      ["icon", "https://cdn.example/icon.png"]
    ]), relays)!;
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

  it("uses title and icon only from signed manifest metadata", () => {
    expect(dockLauncherFromManifest(installation([
      ["title", "Discover prints"],
      ["icon", "https://cdn.example/discover.png"]
    ]), relays)).toMatchObject({
      dTag: "example-napplet",
      title: "Discover prints",
      iconUrl: "https://cdn.example/discover.png"
    });
  });

  it("rejects missing, malformed, and plaintext remote icons", () => {
    expect(dockLauncherFromManifest(installation([]), relays)).toBeUndefined();
    expect(dockLauncherFromManifest(installation([["icon", "not a url"]]), relays)).toBeUndefined();
    expect(dockLauncherFromManifest(installation([["icon", "http://cdn.example/icon.png"]]), relays, true)).toBeUndefined();
  });

  it("allows plaintext localhost icons only in local development", () => {
    const manifest = installation([["icon", "http://localhost:4173/icon.png"]]);
    expect(dockLauncherFromManifest(manifest, relays)).toBeUndefined();
    expect(dockLauncherFromManifest(manifest, relays, true)?.iconUrl).toBe("http://localhost:4173/icon.png");
  });
});
