import { aggregateHash, MemoryPackageStore, sha256 } from "@platform/napplet-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBuiltInNapplets } from "./built-in-napplets.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("built-in Napplet installation", () => {
  it("installs packaged artifacts through the verified package store", async () => {
    const bytes = new TextEncoder().encode("<!doctype html><title>Built in</title>");
    const artifact = { path: "index.html", sha256: await sha256(bytes), mediaType: "text/html" };
    const expectedAggregate = await aggregateHash([artifact]);
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (/napplets(?:\.dev)?\.json$/.test(url)) return new Response(JSON.stringify({
        version: 1,
        napplets: [{ name: "viewer", dTag: "viewer", title: "Viewer", url: "/napplets/viewer/index.html", requires: ["identity"], archetypes: [{ slug: "viewer", convention: "napplet:viewer/open" }], files: [artifact] }]
      }));
      if (url === "/napplets/viewer/index.html") return new Response(bytes);
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    const store = new MemoryPackageStore();

    await expect(installBuiltInNapplets(store, "/")).resolves.toEqual(["viewer"]);
    const active = await store.getActive("viewer");
    expect(active).toMatchObject({ dTag: "viewer", aggregateHash: expectedAggregate });
    expect(active?.manifest.requires).toEqual(["identity"]);
    expect(active?.manifest.archetypes).toEqual([{ slug: "viewer", convention: "napplet:viewer/open" }]);
  });

  it("rejects artifact bytes that disagree with registry", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => /napplets(?:\.dev)?\.json$/.test(String(input))
      ? new Response(JSON.stringify({ version: 1, napplets: [{ name: "bad", dTag: "bad", url: "/napplets/bad/index.html", requires: [], files: [{ path: "index.html", sha256: "0".repeat(64), mediaType: "text/html" }] }] }))
      : new Response("changed")) as typeof fetch;

    await expect(installBuiltInNapplets(new MemoryPackageStore(), "/")).rejects.toThrow("artifact changed");
  });

  it("reactivates an inactive committed built-in version", async () => {
    const versions = await Promise.all(["A", "B"].map(async (version) => {
      const bytes = new TextEncoder().encode(`<!doctype html><title>${version}</title>`);
      const artifact = { path: "index.html", sha256: await sha256(bytes), mediaType: "text/html" };
      return { bytes, artifact, aggregateHash: await aggregateHash([artifact]) };
    }));
    let requestedVersion = 0;
    const artifactFetches = vi.fn();
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (/napplets(?:\.dev)?\.json$/.test(url)) {
        const version = versions[requestedVersion]!;
        return new Response(JSON.stringify({
          version: 1,
          napplets: [{ name: "viewer", dTag: "viewer", url: "/napplets/viewer/index.html", requires: [], files: [version.artifact] }]
        }));
      }
      if (url === "/napplets/viewer/index.html") {
        artifactFetches();
        return new Response(versions[requestedVersion]!.bytes);
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;
    const store = new MemoryPackageStore();

    await expect(installBuiltInNapplets(store, "/")).resolves.toEqual(["viewer"]);
    requestedVersion = 1;
    await expect(installBuiltInNapplets(store, "/")).resolves.toEqual(["viewer"]);
    requestedVersion = 0;
    await expect(installBuiltInNapplets(store, "/")).resolves.toEqual(["viewer"]);

    expect((await store.getActive("viewer"))?.aggregateHash).toBe(versions[0]!.aggregateHash);
    expect(artifactFetches).toHaveBeenCalledTimes(2);
  });

  it("keeps shell startup available when registry is offline", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch;
    await expect(installBuiltInNapplets(new MemoryPackageStore(), "/")).resolves.toEqual([]);
  });
});
