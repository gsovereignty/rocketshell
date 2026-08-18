import { expect, test } from "@playwright/test";

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

test("runs verified fixture as opaque network-isolated Napplet", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#fixture-status")).toHaveText("ready");
  const dataset = await frame.locator("html").evaluate((element) => ({ ...element.dataset }));
  expect(dataset).toMatchObject({ origin: "null", nostr: "undefined", storageBlocked: "true", hostDomBlocked: "true", fetchBlocked: "true", websocketBlocked: "true", pubkey: "", intentReceived: "true", platformProfile: "true", optionalAbsent: "true" });
  expect(await page.locator("iframe").getAttribute("data-virtual-url")).toMatch(/^\/shell\/__napplet__\/platform-fixture\/[a-f0-9]{64}\/index\.html$/);
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

test("reloads shell and verified Napplet while offline", async ({ page, context }) => {
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
