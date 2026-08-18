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
  expect(dataset).toMatchObject({ origin: "null", nostr: "undefined", storageBlocked: "true", fetchBlocked: "true", websocketBlocked: "true", pubkey: "", intentReceived: "true" });
  expect(await page.locator("iframe").getAttribute("data-virtual-url")).toMatch(/^\/shell\/__napplet__\/platform-fixture\/[a-f0-9]{64}\/index\.html$/);
});
