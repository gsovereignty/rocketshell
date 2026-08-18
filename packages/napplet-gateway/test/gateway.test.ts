import { describe, expect, it, vi } from "vitest";
import { validateManifestEvent } from "@napplet/conformance";
import { MemoryPackageStore, NappletWindowManager, PackageInstaller, aggregateHash, installRemotePackage, manifestServers, parseManifest, routeNappletRequest, sha256, virtualNappletUrl, type SignedManifest } from "../src/index.js";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

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
  it("parses standard tag-only named manifests", async () => {
    const hash = "1fadfe7351796f44c67e112fbac33c3cce8fbc8e77b644f0afb204ba4dde4bef";
    const aggregate = "a88be8c8a4e52d3e390c3bbba921070803c568666ebff4c273efced38fb437cc";
    const event: SignedManifest = {
      id: "0".repeat(64), pubkey: "1".repeat(64), created_at: 1, kind: 35129, content: "", sig: "2".repeat(128),
      tags: [["d", "good-morning"], ["path", "/index.html", hash], ["x", aggregate, "aggregate"], ["title", "Good Morning Protocol"], ["requires", "identity"]]
    };
    expect(parseManifest(event, () => true)).toEqual({
      dTag: "good-morning", title: "Good Morning Protocol", aggregateHash: aggregate, entrypoint: "index.html",
      requires: ["identity"], artifacts: [{ path: "index.html", sha256: hash, mediaType: "text/html" }]
    });
    expect(await aggregateHash([{ path: "index.html", sha256: hash }])).toBe(aggregate);
  });
  it("downloads tag-only manifests from signed servers before atomic install", async () => {
    const bytes = new TextEncoder().encode("<h1>Remote</h1>");
    const hash = await sha256(bytes);
    const aggregate = await aggregateHash([{ path: "index.html", sha256: hash }]);
    const event: SignedManifest = {
      id: "0".repeat(64), pubkey: "1".repeat(64), created_at: 1, kind: 35129, content: "", sig: "2".repeat(128),
      tags: [["d", "remote"], ["path", "/index.html", hash], ["x", aggregate, "aggregate"], ["server", "https://cdn.example/base"], ["requires", "identity"]]
    };
    const fetcher = vi.fn(async () => new Response(bytes, { headers: { "content-type": "text/html" } }));
    const store = new MemoryPackageStore();
    const installed = await installRemotePackage(store, event, { fetch: fetcher as typeof fetch, verifyEvent: () => true });
    expect(fetcher).toHaveBeenCalledWith(new URL(`https://cdn.example/base/${hash}`), expect.objectContaining({ credentials: "omit", redirect: "manual" }));
    expect((await store.getActive("remote"))?.aggregateHash).toBe(installed.aggregateHash);
  });
  it("rejects unsafe artifact servers before network work", async () => {
    const input = await fixture();
    const event = { ...input.event, tags: [...input.event.tags, ["server", "http://example.com/"]] };
    expect(() => manifestServers(event)).toThrow("scheme forbidden");
  });
  it("falls back when a signed server returns corrupt artifact bytes", async () => {
    const bytes = new TextEncoder().encode("<h1>Verified</h1>");
    const hash = await sha256(bytes);
    const aggregate = await aggregateHash([{ path: "index.html", sha256: hash }]);
    const event: SignedManifest = {
      id: "0".repeat(64), pubkey: "1".repeat(64), created_at: 1, kind: 35129, content: "", sig: "2".repeat(128),
      tags: [["d", "fallback"], ["path", "/index.html", hash], ["x", aggregate, "aggregate"], ["server", "https://bad.example/"], ["server", "https://good.example/"]]
    };
    const fetcher = vi.fn(async (url: string | URL | Request) => new Response(String(url).includes("bad.example") ? "corrupt" : bytes));
    const store = new MemoryPackageStore();
    await installRemotePackage(store, event, { fetch: fetcher as typeof fetch, verifyEvent: () => true });
    expect(fetcher).toHaveBeenCalledTimes(2);
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
    const html = await response?.text(); expect(html).toContain("<h1>Hello</h1>"); expect(html).toContain("target.napplet"); expect(html).toContain("<script nonce="); expect(html).toContain(`<base href="https://host.test/project/__napplet__/hello%2Fworld/${installed.aggregateHash}/">`);
    expect(response?.headers.get("content-security-policy")).toContain("'nonce-");
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
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
  it("removes a registered window when bridge readiness fails", async () => {
    const store = new MemoryPackageStore(); const input = await fixture();
    await new PackageInstaller(store, () => true).install(input.event, input.inputs);
    const iframe = { setAttribute: vi.fn(), remove: vi.fn(), dataset: {}, contentWindow: {}, title: "", srcdoc: "" };
    vi.stubGlobal("document", { createElement: () => iframe });
    const telemetry = createPlatformTelemetry();
    const manager = new NappletWindowManager(store, {
      register: vi.fn(), waitUntilReady: vi.fn(async () => { throw new Error("not ready"); }), unregister: vi.fn()
    }, { append: vi.fn() } as unknown as HTMLElement, "/shell/", telemetry);
    await expect(manager.create("hello/world")).rejects.toThrow("not ready");
    expect(manager.listWindowIds()).toEqual([]);
    expect(telemetry.snapshot().filter((record) => record.name === "window.active").map((record) => record.value)).toEqual([1, -1]);
    vi.unstubAllGlobals();
  });
  it("shares one cold start across concurrent opens", async () => {
    const store = new MemoryPackageStore(); const input = await fixture();
    await new PackageInstaller(store, () => true).install(input.event, input.inputs);
    const iframe = { setAttribute: vi.fn(), remove: vi.fn(), dataset: {}, contentWindow: {}, title: "", srcdoc: "", focus: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => iframe) });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    let ready: (() => void) | undefined;
    const manager = new NappletWindowManager(store, {
      register: vi.fn(), waitUntilReady: vi.fn(() => new Promise<void>((resolve) => { ready = resolve; })), unregister: vi.fn()
    }, { append: vi.fn() } as unknown as HTMLElement, "/shell/");
    const first = manager.create("hello/world");
    const second = manager.create("hello/world");
    await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
    ready?.();
    expect(await first).toBe(await second);
    expect(document.createElement).toHaveBeenCalledTimes(1);
    manager.close(); vi.unstubAllGlobals();
  });
  it("tears down a cold start that misses readiness timeout", async () => {
    const store = new MemoryPackageStore(); const input = await fixture();
    await new PackageInstaller(store, () => true).install(input.event, input.inputs);
    const iframe = { setAttribute: vi.fn(), remove: vi.fn(), dataset: {}, contentWindow: {}, title: "", srcdoc: "" };
    vi.stubGlobal("document", { createElement: () => iframe });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const unregister = vi.fn();
    const manager = new NappletWindowManager(store, {
      register: vi.fn(), waitUntilReady: vi.fn(() => new Promise<void>(() => {})), unregister
    }, { append: vi.fn() } as unknown as HTMLElement, "/shell/", undefined, 5);
    await expect(manager.create("hello/world")).rejects.toThrow("readiness timed out");
    expect(manager.listWindowIds()).toEqual([]);
    expect(unregister).toHaveBeenCalledOnce();
    expect(iframe.remove).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
