import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolicyFetch, isResourceOriginGranted, resourceGrantKey, resolveResourceGrants } from "../src/index.js";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

describe("resource policy fetch", () => {
  it("scopes grant keys to publisher, d-tag, and aggregate", () => {
    expect(resourceGrantKey("publisher-a", "viewer", "hash")).not.toBe(resourceGrantKey("publisher-b", "viewer", "hash"));
    expect(resourceGrantKey("publisher-a", "viewer", "old")).not.toBe(resourceGrantKey("publisher-a", "viewer", "new"));
  });
  it("does not carry resource grants into a package update", () => {
    const publishers = new Map([["viewer\0old-hash", "publisher-a"], ["viewer\0new-hash", "publisher-b"]]);
    const grants = new Map([[resourceGrantKey("publisher-a", "viewer", "old-hash"), ["https://media.example"]]]);
    const policy = { grants, resolvePublisher: (dTag: string, hash: string) => publishers.get(`${dTag}\0${hash}`) };
    expect(resolveResourceGrants(policy, "viewer", "old-hash")).toEqual(["https://media.example"]);
    expect(resolveResourceGrants(policy, "viewer", "new-hash")).toEqual([]);
  });
  it("allows every origin covered by an HTTPS scheme grant", () => {
    expect(isResourceOriginGranted("https://media.example", ["https:"])).toBe(true);
    expect(isResourceOriginGranted("https://cdn.example", ["https:"])).toBe(true);
    expect(isResourceOriginGranted("http://media.example", ["https:"])).toBe(false);
  });
  it("keeps exact-origin grants narrow", () => {
    expect(isResourceOriginGranted("https://media.example", ["https://media.example"])).toBe(true);
    expect(isResourceOriginGranted("https://cdn.example", ["https://media.example"])).toBe(false);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("strips ambient credential headers and sniffs returned bytes", async () => {
    const telemetry = createPlatformTelemetry();
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      expect(new Headers(init.headers).has("authorization")).toBe(false); expect(init.credentials).toBe("omit");
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await createPolicyFetch({ grants: new Map(), telemetry })("https://media.example/a", { headers: { Authorization: "secret" }, signal: new AbortController().signal });
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(telemetry.snapshot()).toContainEqual(expect.objectContaining({ name: "resource.bytes", value: 8 }));
  });
  it("denies remote plaintext HTTP before fetch", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(createPolicyFetch({ grants: new Map(), allowHttpLocalhost: true })("http://remote.example/a", { signal: new AbortController().signal })).rejects.toThrow("scheme denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not let a redirect leave the granted origin", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.example/private" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createPolicyFetch({ grants: new Map() })("https://media.example/a", { signal: new AbortController().signal })).rejects.toThrow("Cross-origin resource redirect denied");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
