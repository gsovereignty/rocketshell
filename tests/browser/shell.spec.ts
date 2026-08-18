import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

declare global {
  interface Window {
    __platformTest?: {
      windows: { listWindowIds(): readonly string[] };
      destroyWindow(windowId: string): void;
      authenticatedWindowIds(): readonly string[];
      telemetrySnapshot(): readonly { name: string; value: number }[];
      connectExtension(): Promise<string>;
    };
  }
}

test("starts under repository subpath and gains service-worker control", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  expect(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/shell/")))).toBe(true);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/shell/service-worker.js"))).toBe(true);
});

test("build contains no root-relative project asset URLs", async ({ page }) => {
  await page.goto("./");
  const urls = await page.locator("script[src],link[href]").evaluateAll((elements) => elements.map((element) => element.getAttribute("src") ?? element.getAttribute("href")));
  expect(urls.filter(Boolean).every((url) => url!.startsWith("/shell/") || url!.startsWith("./"))).toBe(true);
});

test("isolates package, public event, and private account persistence", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
  expect(names).toEqual(expect.arrayContaining(["napplet-packages", "platform-events", "platform-private", "platform-metadata"]));
  expect(new Set(names).size).toBe(names.length);
  const metadata = await page.evaluate(async () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = indexedDB.open("platform-metadata");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("records", "readonly");
      const get = transaction.objectStore("records").get("compatibility");
      get.onerror = () => reject(get.error); get.onsuccess = () => resolve(get.result);
    };
  }));
  expect(metadata).toMatchObject({ profile: "platform-nap-v1", schemaVersions: { metadata: 1, packages: 1, privateAccounts: 1 } });
});

test("runs verified fixture as opaque network-isolated Napplet", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#fixture-status")).toHaveText("ready");
  const dataset = await frame.locator("html").evaluate((element) => ({ ...element.dataset }));
  expect(dataset.resourceError).toBe("");
  expect(dataset).toMatchObject({ origin: "null", nostr: "undefined", storageBlocked: "true", hostDomBlocked: "true", fetchBlocked: "true", websocketBlocked: "true", resourceFetched: "true", resourceObjectUrl: "true", resourceRevoked: "true", pubkey: "", intentReceived: "true", platformProfile: "true", optionalAbsent: "true" });
  expect(await page.locator("iframe").getAttribute("data-virtual-url")).toMatch(/^\/shell\/__napplet__\/platform-fixture\/[a-f0-9]{64}\/index\.html$/);
  expect(await page.evaluate(() => window.__platformTest?.telemetrySnapshot().some((record) => record.name === "window.active" && record.value === 1))).toBe(true);
});

test("mediates Blossom upload without exposing signer or server selection", async ({ page }) => {
  const secret = new Uint8Array(32); secret[31] = 7;
  const pubkey = getPublicKey(secret);
  await page.exposeFunction("__platformTestSignEvent", (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, secret));
  await page.addInitScript((activePubkey) => {
    Object.defineProperty(window, "nostr", { value: {
      getPublicKey: async () => activePubkey,
      signEvent: (template: { kind: number; created_at: number; content: string; tags: string[][] }) => (window as unknown as { __platformTestSignEvent(value: typeof template): Promise<unknown> }).__platformTestSignEvent(template)
    }, configurable: true });
  }, pubkey);
  let authorization = "";
  await page.route("**/mock-blossom/upload", async (route) => {
    const request = route.request();
    const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
    authorization = request.headers().authorization ?? "";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "https://cdn.example/uploaded.txt",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        type: request.headers()["content-type"]
      })
    });
  });
  await page.goto("./");
  await expect(page.frameLocator('iframe[title="platform-fixture"]').locator("#fixture-status")).toHaveText("ready");
  await page.evaluate(() => window.__platformTest?.connectExtension());
  const result = await page.frameLocator('iframe[title="platform-fixture"]').locator("html").evaluate(async () => {
    const value = await window.napplet.upload.upload({ data: new Blob(["host-owned upload"], { type: "text/plain" }), rail: "blossom", filename: "proof.txt", mimeType: "text/plain" });
    return {
      ok: value.ok, rail: value.rail, url: value.url, size: value.size, error: value.error,
      signer: typeof window.nostr,
      rawFetchServerKnown: document.documentElement.innerHTML.includes("mock-blossom")
    };
  });
  expect(result).toEqual({
    ok: true, rail: "blossom", url: "https://cdn.example/uploaded.txt", size: 17, error: undefined,
    signer: "undefined", rawFetchServerKnown: false
  });
  expect(authorization).toMatch(/^Nostr /);
  const event = JSON.parse(Buffer.from(authorization.slice(6), "base64").toString("utf8"));
  expect(event).toMatchObject({ kind: 24242, pubkey, tags: expect.arrayContaining([["t", "upload"]]) });
});

test("rejects shell messages from an unregistered source window", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const receivedInit = await page.evaluate(async () => {
    const probe = document.createElement("iframe");
    probe.setAttribute("sandbox", "allow-scripts");
    probe.srcdoc = `<script>let gotInit=false;addEventListener('message',e=>{if(e.data?.type==='shell.init')gotInit=true});parent.postMessage({type:'shell.ready'},'*');setTimeout(()=>parent.postMessage({type:'probe.result',gotInit},'*'),200)</script>`;
    const result = new Promise<boolean>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.source !== probe.contentWindow || event.data?.type !== "probe.result") return;
        window.removeEventListener("message", listener);
        resolve(Boolean(event.data.gotInit));
      };
      window.addEventListener("message", listener);
    });
    document.body.append(probe);
    const received = await result;
    probe.remove();
    return received;
  });
  expect(receivedInit).toBe(false);
});

test("reloads shell and verified Napplet while offline", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "Playwright WebKit offline reload is unsupported");
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
});

test("destroying a Napplet removes its authenticated session", async ({ page }) => {
  await page.goto("./");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  const before = await page.evaluate(() => ({
    managed: window.__platformTest?.windows.listWindowIds() ?? [],
    authenticated: window.__platformTest?.authenticatedWindowIds() ?? []
  }));
  expect(before.managed).toHaveLength(1);
  expect(before.authenticated).toEqual(before.managed);
  await page.evaluate((windowId) => window.__platformTest?.destroyWindow(windowId), before.managed[0]!);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(await page.evaluate(() => window.__platformTest?.windows.listWindowIds())).toEqual([]);
  expect(await page.evaluate(() => window.__platformTest?.authenticatedWindowIds())).toEqual([]);
});

test("coordinate loader reports malformed input without opening a window", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await page.locator("#coordinate").fill("not-a-coordinate");
  const openButton = page.getByRole("button", { name: "Open Napplet" });
  await expect(openButton).toBeEnabled();
  await openButton.click();
  await expect(page.locator("#loader-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#loader-status")).toHaveText("Use naddr or kind:pubkey:identifier");
  await expect(page.locator("#windows iframe")).toHaveCount(1);
});
