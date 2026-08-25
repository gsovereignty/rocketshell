import { aggregateHash, MemoryPackageStore, sha256 } from "@platform/napplet-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBuiltInNapplets } from "./built-in-napplets.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("built-in Napplet installation", () => {
  it("selects the live dev registry without consulting a packaged production snapshot", async () => {
    const bytes = new TextEncoder().encode("<!doctype html><title>Live dev</title>");
    const artifact = { path: "index.html", sha256: await sha256(bytes), mediaType: "text/html" };
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url === "/napplets.dev.json") return new Response(JSON.stringify({
        version: 1,
        napplets: [{ name: "viewer", dTag: "viewer", url: "/napplets.dev/viewer/index.html", requires: [], files: [artifact] }]
      }));
      if (url === "/napplets.dev/viewer/index.html") return new Response(bytes);
      return new Response("stale production snapshot", { status: 200 });
    }) as typeof fetch;

    const store = new MemoryPackageStore();
    await installBuiltInNapplets(store, "/", "napplets.dev.json");
    expect(requested).toEqual(["/napplets.dev.json", "/napplets.dev/viewer/index.html"]);
  });

  it("selects only the packaged production registry in production mode", async () => {
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ version: 1, napplets: [] }));
    }) as typeof fetch;
    await installBuiltInNapplets(new MemoryPackageStore(), "/", "napplets.json");
    expect(requested).toEqual(["/napplets.json"]);
  });

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

  it("rejects a successful activation call that leaves the old version active", async () => {
    const bytes = new TextEncoder().encode("<!doctype html><title>Expected</title>");
    const artifact = { path: "index.html", sha256: await sha256(bytes), mediaType: "text/html" };
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => String(input).endsWith("napplets.json")
      ? new Response(JSON.stringify({ version: 1, napplets: [{ name: "viewer", dTag: "viewer", url: "/napplets/viewer/index.html", requires: [], files: [artifact] }] }))
      : new Response(bytes)) as typeof fetch;
    const store = new MemoryPackageStore();
    store.activate = vi.fn(async () => undefined);
    await expect(installBuiltInNapplets(store, "/")).rejects.toThrow("activation failed: viewer");
  });

  it("keeps shell startup available when registry is offline", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch;
    await expect(installBuiltInNapplets(new MemoryPackageStore(), "/")).resolves.toEqual([]);
  });
});
