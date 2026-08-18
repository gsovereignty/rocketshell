import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolicyFetch, resourceGrantKey } from "../src/index.js";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

describe("resource policy fetch", () => {
  it("scopes grant keys to publisher, d-tag, and aggregate", () => {
    expect(resourceGrantKey("publisher-a", "viewer", "hash")).not.toBe(resourceGrantKey("publisher-b", "viewer", "hash"));
    expect(resourceGrantKey("publisher-a", "viewer", "old")).not.toBe(resourceGrantKey("publisher-a", "viewer", "new"));
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
