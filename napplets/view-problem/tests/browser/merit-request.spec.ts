import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const owner = "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075";
const problemId = "7cff61a9f7565ed63c1213040fe0f39c7f2ee1dd4fb96a41e95de049a8dcc170";
const coordinate = `31971:${owner}:${problemId}`;

const problemResult = (status: string) => ({
  event: {
    id: "a".repeat(64), pubkey: owner, kind: 31971, created_at: 1,
    content: "Completed wallet setup work.", sig: "f".repeat(128),
    tags: [
      ["d", problemId], ["title", "Wallet setup is slow"], ["status", status],
      ["a", coordinate, "", "origin"], ["A", coordinate, ""]
    ]
  },
  sidecar: { relayHints: [] }
});

const packagedHtml = (status: string): string => {
  const runtime = `<script>
    window.__intentInvocations = [];
    const result = ${JSON.stringify(problemResult(status))};
    Object.defineProperty(window, "napplet", { configurable: true, value: {
      identity: { getPublicKey: async () => "", onChanged: () => ({ close() {} }) },
      outbox: {
        query: async () => ({ events: [result] }),
        subscribe: () => ({ on() {}, close() {} }),
        publish: async () => ({ ok: false, error: "not used" })
      },
      intent: {
        invoke: async (request) => { window.__intentInvocations.push(request); return { ok: true, handled: true }; }
      },
      inc: { on: () => ({ close() {} }) },
      resource: { bytes: async () => { throw new Error("not used"); } }
    } });
  </script>`;
  return readFileSync(new URL("../../dist/index.html", import.meta.url), "utf8").replace("<head>", `<head>${runtime}`);
};

const mount = async (page: import("@playwright/test").Page, status: string) => {
  await page.setContent('<iframe title="packaged-view-problem" sandbox="allow-scripts"></iframe>');
  await page.locator("iframe").evaluate((iframe, html) => { iframe.srcdoc = html; }, packagedHtml(status));
  const frame = page.frameLocator('iframe[title="packaged-view-problem"]');
  await frame.getByLabel("Problem coordinate").fill(coordinate);
  await frame.getByRole("button", { name: "View problem" }).click();
  await expect(frame.getByRole("heading", { name: "Wallet setup is slow" })).toBeVisible();
  return frame;
};

test("closed problem opens merit composer through production intent", async ({ page }) => {
  const frame = await mount(page, "closed");
  await frame.getByRole("button", { name: "Request merits" }).click();
  await expect.poll(() => frame.locator("html").evaluate(() => (window as Window & { __intentInvocations: unknown[] }).__intentInvocations)).toEqual([{
    archetype: "composer",
    action: "merit-request",
    convention: "napplet:composer/merit-request",
    payload: { problem: "Wallet setup is slow" },
    behavior: { focus: false, reuse: true }
  }]);
});

test("non-closed problem has no merit request action", async ({ page }) => {
  const frame = await mount(page, "patched");
  await expect(frame.getByRole("button", { name: "Request merits" })).toHaveCount(0);
});
