import { expect, test } from "@playwright/test";

test("runs built STLstr Napplet with exact manifest environment", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const iframe = page.locator('iframe[title="stl-preview"]');
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  const frame = page.frameLocator('iframe[title="stl-preview"]');
  await expect(frame.locator('[data-testid="preview-status"]')).toHaveText("Paste an STL file URL to preview it.");
  const evidence = await frame.locator("html").evaluate(async () => {
    const required = ["inc", "link", "resource", "theme"];
    const undeclared = ["identity", "outbox", "relay", "storage", "intent", "upload"];
    const directFetchBlocked = typeof fetch !== "function" || await fetch("https://example.com").then(() => false, () => true);
    let storageBlocked = false;
    try { localStorage.setItem("probe", "x"); } catch { storageBlocked = true; }
    let hostDomBlocked = false;
    try { void parent.document.body; } catch { hostDomBlocked = true; }
    return {
      origin: window.origin,
      required: required.every((domain) => window.napplet.shell.supports(domain)),
      undeclared: undeclared.every((domain) => !window.napplet.shell.supports(domain)),
      directFetchBlocked, storageBlocked, hostDomBlocked,
      nostr: typeof window.nostr,
      persistenceSealed: typeof localStorage === "undefined" && typeof sessionStorage === "undefined" && typeof indexedDB === "undefined" && typeof caches === "undefined"
    };
  });
  expect(evidence).toEqual({
    origin: "null", required: true, undeclared: true,
    directFetchBlocked: true, storageBlocked: true, hostDomBlocked: true,
    nostr: "undefined", persistenceSealed: true
  });
});
