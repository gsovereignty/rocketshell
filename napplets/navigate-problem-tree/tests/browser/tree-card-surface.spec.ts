import { expect, test } from "@playwright/test";

const owner = "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075";
const rootId = "7cff61a9f7565ed63c1213040fe0f39c7f2ee1dd4fb96a41e95de049a8dcc170";
const root = `31971:${owner}:${rootId}`;
const hex = (character: string) => character.repeat(64);
const coordinate = (character: string) => `31971:${owner}:${hex(character)}`;

const problem = (id: string, problemCoordinate: string, title: string, parent?: string) => ({
  event: {
    id,
    pubkey: owner,
    kind: 31971,
    created_at: 1,
    content: "",
    sig: hex("f"),
    tags: [
      ["d", problemCoordinate.split(":")[2]],
      ["title", title],
      ["status", "open"],
      ["a", problemCoordinate, "", "origin"],
      ["A", root, ""],
      ...(parent ? [["a", parent, ""]] : [])
    ]
  },
  sidecar: { relayHints: [] }
});

const events = [
  problem(hex("1"), root, "Root problem"),
  problem(hex("2"), coordinate("2"), "Bitcoin is not fixing the world fast enough", root),
  problem(hex("3"), coordinate("3"), "We keep cucking ourselves by registering companies with the State", coordinate("2")),
  problem(hex("4"), coordinate("4"), "Nostrocket is not currently applicable to more than a few people", coordinate("3")),
  problem(hex("5"), coordinate("5"), "Can't submit patches on problems", coordinate("4")),
  problem(hex("6"), coordinate("6"), "Nostrocket napplets are missing basic functionality", coordinate("4")),
  problem(hex("7"), coordinate("7"), "Leaf below first branch", coordinate("5")),
  problem(hex("8"), coordinate("8"), "Leaf below second branch", coordinate("6"))
];

type NodeVisual = {
  coordinate: string;
  backgroundColor: string;
  rect: { x: number; y: number; width: number; height: number };
};

const nodeVisuals = async (page: import("@playwright/test").Page): Promise<NodeVisual[]> =>
  page.locator(".tree-node").evaluateAll((nodes) => nodes.map((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      coordinate: element.dataset.select ?? "",
      backgroundColor: getComputedStyle(element).backgroundColor,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  }));

const isOpaqueSurface = (color: string) => color !== "transparent" && !/rgba\([^)]*,\s*0\s*\)$/.test(color);

test("tree selection changes palette without changing card footprint", async ({ page }) => {
  await page.addInitScript((queryEvents) => {
    Object.defineProperty(window, "napplet", {
      configurable: true,
      value: {
        outbox: {
          query: async () => ({ events: queryEvents }),
          subscribe: () => ({ on: () => undefined, close: () => undefined })
        },
        intent: {
          available: async () => ({ available: false, candidates: [] }),
          invoke: async () => ({ ok: false, handled: false })
        }
      }
    });
  }, events);

  await page.goto("/");
  const nodes = page.locator(".tree-node");
  await expect(nodes).toHaveCount(5);

  const before = await nodeVisuals(page);
  await nodes.nth(3).click();
  await expect(page.locator('.tree-node[aria-current="true"]')).toHaveCount(1);
  const after = await nodeVisuals(page);

  expect(after.map(({ coordinate: id, rect }) => ({ coordinate: id, rect }))).toEqual(
    before.map(({ coordinate: id, rect }) => ({ coordinate: id, rect }))
  );

  const selected = after.find(({ coordinate: id }) => id === coordinate("5"));
  const unselected = after.filter(({ coordinate: id }) => id !== coordinate("5"));
  expect(selected && isOpaqueSurface(selected.backgroundColor)).toBe(true);
  expect(unselected.map(({ backgroundColor }) => backgroundColor)).not.toContain("rgba(0, 0, 0, 0)");
  expect(unselected.every(({ backgroundColor }) => isOpaqueSurface(backgroundColor))).toBe(true);
});

test("tree growth scrolls inside its pane without reflowing cards", async ({ page }) => {
  await page.addInitScript((queryEvents) => {
    Object.defineProperty(window, "napplet", {
      configurable: true,
      value: {
        outbox: {
          query: async () => ({ events: queryEvents }),
          subscribe: () => ({ on: () => undefined, close: () => undefined })
        },
        intent: {
          available: async () => ({ available: false, candidates: [] }),
          invoke: async () => ({ ok: false, handled: false })
        }
      }
    });
  }, events);

  await page.goto("/");
  const pane = page.locator(".tree-pane");
  const nodes = page.locator(".tree-node");
  await expect(nodes).toHaveCount(5);

  const before = await nodeVisuals(page);
  await pane.evaluate((element) => {
    const growth = document.createElement("div");
    growth.dataset.testGrowth = "";
    growth.style.height = "1000px";
    element.append(growth);
  });
  await expect.poll(() => pane.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const after = await nodeVisuals(page);

  expect(after.map(({ rect }) => ({ x: rect.x, width: rect.width }))).toEqual(
    before.map(({ rect }) => ({ x: rect.x, width: rect.width }))
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientHeight)
  );
});

test("each tree edge renders its line and arrow in one SVG path", async ({ page }) => {
  await page.addInitScript((queryEvents) => {
    Object.defineProperty(window, "napplet", {
      configurable: true,
      value: {
        outbox: {
          query: async () => ({ events: queryEvents }),
          subscribe: () => ({ on: () => undefined, close: () => undefined })
        },
        intent: {
          available: async () => ({ available: false, candidates: [] }),
          invoke: async () => ({ ok: false, handled: false })
        }
      }
    });
  }, events);

  await page.goto("/");
  await expect(page.locator(".tree-node")).toHaveCount(5);
  await expect(page.locator(".incoming-connector, .connector-line, .connector-arrow")).toHaveCount(0);
  await expect(page.locator(".tree-connectors")).toHaveCount(3);

  const paths = page.locator(".connector-path-base");
  await expect(paths).toHaveCount(4);
  await expect(paths.first()).toHaveAttribute("d", /^M 1 0 V [\d.]+ H 16 M 11 [\d.]+ L 16 [\d.]+ L 11 [\d.]+$/);
  await page.locator(".tree-node").nth(3).click();
  await expect(page.locator(".active-connector-path")).toHaveCount(3);
  await expect(page.locator(".active-connector-path").first()).toHaveCSS("stroke", "rgb(20, 92, 255)");
});
