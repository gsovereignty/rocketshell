// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcePreviewCache } from "./media";

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => vi.restoreAllMocks());

describe("resource preview cache", () => {
  it("deduplicates loads and revokes shared object URLs after final release", async () => {
    const load = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const cache = new ResourcePreviewCache(load);
    const first = cache.acquire("https://example.test/a.png");
    const second = cache.acquire("https://example.test/a.png");
    expect(await first).toBe("blob:preview");
    expect(await second).toBe("blob:preview");
    expect(load).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    cache.release("https://example.test/a.png");
    expect(revoke).not.toHaveBeenCalled();
    cache.release("https://example.test/a.png");
    expect(revoke).toHaveBeenCalledWith("blob:preview");
  });

  it("revokes every remaining object URL on teardown", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:a").mockReturnValueOnce("blob:b");
    const cache = new ResourcePreviewCache(async () => new Blob(["image"], { type: "image/png" }));
    await Promise.all([cache.acquire("https://example.test/a.png"), cache.acquire("https://example.test/b.png")]);
    cache.destroy();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
