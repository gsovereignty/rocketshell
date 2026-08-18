import { describe, expect, it } from "vitest";
import { validateManifestEvent } from "@napplet/conformance";
import { MemoryPackageStore, PackageInstaller, aggregateHash, parseManifest, routeNappletRequest, sha256, virtualNappletUrl, type SignedManifest } from "../src/index.js";

async function fixture(html = "<h1>Hello</h1>"): Promise<{ event: SignedManifest; inputs: Map<string, { bytes: Uint8Array }> }> {
  const bytes = new TextEncoder().encode(html);
  const hash = await sha256(bytes); const aggregate = await aggregateHash([{ path: "index.html", sha256: hash }]);
  const content = JSON.stringify({ dTag: "hello/world", aggregateHash: aggregate, entrypoint: "index.html", requires: ["identity"], artifacts: [{ path: "index.html", sha256: hash, mediaType: "text/html" }] });
  return { event: { id: "0".repeat(64), pubkey: "1".repeat(64), created_at: 1, kind: 35129, tags: [["d", "hello/world"], ["requires", "identity"], ["path", "/index.html", hash]], content, sig: "2".repeat(128) }, inputs: new Map([["index.html", { bytes }]]) };
}

describe("package gateway", () => {
  it("verifies, commits, and atomically activates package", async () => {
    const store = new MemoryPackageStore(); const { event, inputs } = await fixture();
    const installed = await new PackageInstaller(store, () => true).install(event, inputs, { randomId: () => "install-1", now: () => 10 });
    expect((await store.getActive("hello/world"))?.aggregateHash).toBe(installed.aggregateHash);
  });
  it("passes official NIP-5D manifest conformance", async () => {
    const { event } = await fixture();
    expect(validateManifestEvent(event)).toMatchObject({ ok: true, kind: 35129, dTag: "hello/world", requires: ["identity"] });
  });
  it("does not route failed staging", async () => {
    const store = new MemoryPackageStore(); const { event, inputs } = await fixture();
    inputs.set("index.html", { bytes: new TextEncoder().encode("tampered") });
    await expect(new PackageInstaller(store, () => true).install(event, inputs)).rejects.toThrow("Artifact hash mismatch");
    expect(await store.getActive("hello/world")).toBeUndefined();
  });
  it("keeps old and new immutable versions after active update", async () => {
    const store = new MemoryPackageStore();
    const firstInput = await fixture("<h1>Version one</h1>");
    const first = await new PackageInstaller(store, () => true).install(firstInput.event, firstInput.inputs, { randomId: () => "install-1" });
    const secondInput = await fixture("<h1>Version two</h1>");
    const second = await new PackageInstaller(store, () => true).install(secondInput.event, secondInput.inputs, { randomId: () => "install-2" });
    expect(first.aggregateHash).not.toBe(second.aggregateHash);
    expect((await store.getActive(first.dTag))?.aggregateHash).toBe(second.aggregateHash);
    expect(new TextDecoder().decode((await store.getArtifact(first.dTag, first.aggregateHash, "index.html"))?.bytes)).toBe("<h1>Version one</h1>");
    expect(new TextDecoder().decode((await store.getArtifact(second.dTag, second.aggregateHash, "index.html"))?.bytes)).toBe("<h1>Version two</h1>");
    const returned = await store.get(first.dTag, first.aggregateHash);
    returned!.artifacts[0]!.bytes[0] = 0;
    expect(new TextDecoder().decode((await store.getArtifact(first.dTag, first.aggregateHash, "index.html"))?.bytes)).toBe("<h1>Version one</h1>");
  });
  it("serves only exact immutable route with restrictive headers", async () => {
    const store = new MemoryPackageStore(); const { event, inputs } = await fixture();
    const installed = await new PackageInstaller(store, () => true).install(event, inputs);
    const url = virtualNappletUrl("/project/", installed.dTag, installed.aggregateHash, "index.html");
    const response = await routeNappletRequest(new Request(`https://host.test${url}`), "/project/", store);
    expect(response?.status).toBe(200); expect(response?.headers.get("content-security-policy")).toContain("connect-src 'none'");
    const html = await response?.text(); expect(html).toContain("<h1>Hello</h1>"); expect(html).toContain("target.napplet"); expect(html).toContain("<script nonce=");
    expect(response?.headers.get("content-security-policy")).toContain("'nonce-");
    expect((await routeNappletRequest(new Request(`https://host.test${url}x`), "/project/", store))?.status).toBe(404);
  });
  it("accepts known optional domains and rejects unknown domains", async () => {
    const { event } = await fixture();
    const content = JSON.parse(event.content) as Record<string, unknown>;
    const optional = { ...event, tags: [...event.tags, ["requires", "notify"]], content: JSON.stringify({ ...content, requires: ["identity", "notify"] }) };
    expect(parseManifest(optional, () => true).requires).toContain("notify");
    const unknown = { ...event, content: JSON.stringify({ ...content, requires: ["identity", "not-real"] }) };
    expect(() => parseManifest(unknown, () => true)).toThrow("Invalid required domain");
  });
});
