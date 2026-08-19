import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import type { SignedManifest } from "@platform/napplet-gateway";
import { dockLauncherFromManifest, dockLauncherPointers } from "./dock-launchers.js";

const event = (tags: string[][]): SignedManifest => ({
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1,
  kind: 35129,
  tags,
  content: "",
  sig: "c".repeat(128)
});

describe("dock launcher catalog", () => {
  it("builds stable kind-35129 naddrs without runtime configuration", () => {
    const launchers = dockLauncherPointers();
    expect(launchers.length).toBeGreaterThan(1);
    for (const launcher of launchers) {
      const decoded = nip19.decode(launcher.coordinate);
      expect(decoded.type).toBe("naddr");
      if (decoded.type !== "naddr") continue;
      expect(decoded.data.kind).toBe(35129);
      expect(decoded.data.identifier).toBe(launcher.dTag);
    }
  });

  it("uses title and icon only from signed manifest metadata", () => {
    const pointer = dockLauncherPointers()[0]!;
    expect(dockLauncherFromManifest(pointer, event([
      ["d", pointer.dTag],
      ["title", "Discover prints"],
      ["icon", "https://cdn.example/discover.png"]
    ]))).toEqual({ ...pointer, title: "Discover prints", iconUrl: "https://cdn.example/discover.png" });
  });

  it("rejects missing, malformed, and plaintext remote icons", () => {
    const pointer = dockLauncherPointers()[0]!;
    expect(dockLauncherFromManifest(pointer, event([]))).toBeUndefined();
    expect(dockLauncherFromManifest(pointer, event([["icon", "not a url"]]))).toBeUndefined();
    expect(dockLauncherFromManifest(pointer, event([["icon", "http://cdn.example/icon.png"]]), true)).toBeUndefined();
  });

  it("allows plaintext localhost icons only in local development", () => {
    const pointer = dockLauncherPointers()[0]!;
    const manifest = event([["icon", "http://localhost:4173/icon.png"]]);
    expect(dockLauncherFromManifest(pointer, manifest)).toBeUndefined();
    expect(dockLauncherFromManifest(pointer, manifest, true)?.iconUrl).toBe("http://localhost:4173/icon.png");
  });
});
