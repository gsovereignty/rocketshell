import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolicyFetch } from "../src/index.js";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

describe("resource policy fetch", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("strips ambient credential headers and sniffs returned bytes", async () => {
    const telemetry = createPlatformTelemetry();
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      expect(new Headers(init.headers).has("authorization")).toBe(false); expect(init.credentials).toBe("omit");
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await createPolicyFetch({ telemetry })("https://media.example/a", { headers: { Authorization: "secret" }, signal: new AbortController().signal });
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(telemetry.snapshot()).toContainEqual(expect.objectContaining({ name: "resource.bytes", value: 8 }));
  });
  it("denies remote plaintext HTTP before fetch", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(createPolicyFetch({ allowHttpLocalhost: true })("http://remote.example/a", { signal: new AbortController().signal })).rejects.toThrow("scheme denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("follows a cross-origin HTTPS image redirect", async () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://image.example/avatar.jpg" } }))
      .mockResolvedValueOnce(new Response(image));
    vi.stubGlobal("fetch", fetchMock);
    const response = await createPolicyFetch({})("https://media.example/a", { signal: new AbortController().signal });
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenNthCalledWith(2, new URL("https://image.example/avatar.jpg"), expect.objectContaining({ redirect: "manual" }));
  });
  it.each([
    ["MP4", new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), "video/mp4"],
    ["WebM", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm"]
  ])("allows shell-fetched %s video bytes", async (_label, bytes, mimeType) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const response = await createPolicyFetch({})("https://media.example/video", { signal: new AbortController().signal });
    expect(response.headers.get("content-type")).toBe(mimeType);
  });
});
