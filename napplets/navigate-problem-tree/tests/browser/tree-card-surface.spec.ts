import { expect, test } from "@playwright/test";

const owner = "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075";
const rootId = "7cff61a9f7565ed63c1213040fe0f39c7f2ee1dd4fb96a41e95de049a8dcc170";
const root = `31971:${owner}:${rootId}`;
const hex = (character: string) => character.repeat(64);
const coordinate = (character: string) => `31971:${owner}:${hex(character)}`;
const connectorTipX = 24;

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

test("long child list scrolls inside its pane", async ({ page }) => {
  const manyLeaves = Array.from({ length: 24 }, (_, index) => {
    const value = (index + 16).toString(16).padStart(64, "0");
    return problem(value, `31971:${owner}:${value}`, `Actionable child ${index + 1}`, root);
  });
  await page.setViewportSize({ width: 1100, height: 600 });
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
  }, [problem(hex("1"), root, "Root problem"), ...manyLeaves]);

  await page.goto("/");
  const list = page.locator(".problem-list");
  const rows = page.locator(".problem-row");
  const firstRow = rows.first();
  const lastRow = rows.last();
  await expect(rows).toHaveCount(manyLeaves.length);
  await expect.poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const documentScrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));

  await list.hover();
  for (let tick = 0; tick < 20; tick += 1) await page.mouse.wheel(0, 500);
  await expect.poll(() => list.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
  await expect(lastRow).toBeInViewport();
  await expect(firstRow).not.toBeInViewport();
  await expect(page.locator(".list-header")).toBeInViewport();
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(documentScrollBefore);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientHeight)
  );

  for (let tick = 0; tick < 20; tick += 1) await page.mouse.wheel(0, -500);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(firstRow).toBeInViewport();
  await expect(lastRow).not.toBeInViewport();
  await expect(page.locator(".list-header")).toBeInViewport();
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(documentScrollBefore);
});

test("mobile page owns child-list scrolling without horizontal overflow", async ({ page }) => {
  const manyLeaves = Array.from({ length: 24 }, (_, index) => {
    const value = (index + 16).toString(16).padStart(64, "0");
    return problem(value, `31971:${owner}:${value}`, `Actionable child ${index + 1}`, root);
  });
  await page.setViewportSize({ width: 390, height: 844 });
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
  }, [problem(hex("1"), root, "Root problem"), ...manyLeaves]);

  await page.goto("/");
  const list = page.locator(".problem-list");
  const rows = page.locator(".problem-row");
  const firstRow = rows.first();
  const lastRow = rows.last();
  await expect(rows).toHaveCount(manyLeaves.length);
  await expect(firstRow).toBeInViewport();
  await expect.poll(() => list.evaluate((element) => element.scrollHeight === element.clientHeight)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth)
  );

  await page.mouse.move(380, 800);
  for (let tick = 0; tick < 20; tick += 1) await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)).toBe(true);
  await expect(lastRow).toBeInViewport();
  await expect(firstRow).not.toBeInViewport();
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth)
  );
});

test("filter controls fit without horizontal scrolling", async ({ page }) => {
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

  for (const width of [280, 320, 430, 760]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/");
    const filters = page.locator("#filters");
    await expect(filters.locator("button")).toHaveCount(5);
    const layout = await filters.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      childrenFit: Array.from(element.children).every((child) => {
        const parent = element.getBoundingClientRect();
        const button = child.getBoundingClientRect();
        return button.left >= parent.left && button.right <= parent.right;
      })
    }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.overflowX).toBe("hidden");
    expect(layout.childrenFit).toBe(true);
  }
});

test("each tree edge renders one thick straight SVG arrow", async ({ page }) => {
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
  await expect(page.locator(".incoming-connector, .connector-line, .connector-arrow, .connector-path-base, .active-connector-path")).toHaveCount(0);
  await expect(page.locator(".tree-connectors")).toHaveCount(3);

  const paths = page.locator(".connector-path");
  await expect(paths).toHaveCount(4);
  const pathData = await paths.first().getAttribute("d");
  expect(pathData).toMatch(/^M 1 0 V \d+(?:\.\d+)? H 24$/);
  expect(pathData?.match(/\bM\b/g)).toHaveLength(1);
  expect(pathData?.match(/\bV\b/g)).toHaveLength(1);
  expect(pathData?.match(/\bH\b/g)).toHaveLength(1);
  expect(pathData?.endsWith(`H ${connectorTipX}`)).toBe(true);
  const viewportClearance = await page.locator(".tree-connectors").evaluateAll((connectors) =>
    connectors.every((connector) => {
      const svg = connector as SVGSVGElement;
      const paths = Array.from(svg.querySelectorAll<SVGPathElement>(":scope > .connector-path"));
      const finalY = Math.max(...paths.map((path) => path.getPointAtLength(path.getTotalLength()).y));
      return svg.viewBox.baseVal.height - finalY >= 8;
    }));
  expect(viewportClearance).toBe(true);
  await expect(paths.first()).toHaveAttribute("marker-end", /url\(#tree-arrow-\d+\)/);
  await expect(paths.first()).toHaveCSS("stroke-width", "4px");
  await expect(paths.first()).toHaveCSS("stroke-dasharray", "none");
  await expect(page.locator(".tree-connectors marker")).toHaveCount(3);
  await page.locator(".tree-node").nth(3).click();
  await expect(page.locator(".connector-path.is-active")).toHaveCount(3);
  await expect(page.locator(".connector-path.is-active").first()).toHaveCSS("stroke", "rgb(20, 92, 255)");
  expect(await page.locator(".connector-path").evaluateAll((connectorPaths) =>
    connectorPaths.every((path) => getComputedStyle(path).strokeDasharray === "none"))).toBe(true);

  await page.evaluate(() => {
    (window as typeof window & { connectorMutations: number }).connectorMutations = 0;
    document.querySelectorAll(".tree-connectors").forEach((connector) => {
      new MutationObserver((records) => {
        (window as typeof window & { connectorMutations: number }).connectorMutations += records.filter((record) => record.type === "childList").length;
      }).observe(connector, { childList: true });
    });
  });
  await page.locator(".tree-node").nth(1).hover();
  await page.locator(".tree-node").nth(4).hover();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { connectorMutations: number }).connectorMutations)).toBe(0);
  await page.locator(".tree-node").nth(1).hover();
  await page.waitForTimeout(50);
  await page.locator(".tree-node").nth(2).hover();
  await page.waitForTimeout(50);
  await page.locator(".tree-node").nth(4).hover();
  expect(await page.locator(".connector-path").evaluateAll((connectorPaths) =>
    connectorPaths.every((path) => getComputedStyle(path).strokeDasharray === "none"))).toBe(true);

  const glyph = await page.locator(".connector-path").first().evaluate((path) => {
    const card = path.closest("ul")?.querySelector(":scope > .branch > .tree-node");
    return { right: path.getBoundingClientRect().right, cardLeft: card?.getBoundingClientRect().left ?? 0 };
  });
  expect(glyph.right).toBeLessThanOrEqual(glyph.cardLeft);

  const renderedEdges = await page.locator(".connector-path.is-active").evaluateAll((activePaths, tipX) =>
    activePaths.map((activePath) => {
      const path = activePath as SVGPathElement;
      const svg = path.ownerSVGElement;
      const card = svg?.closest("ul")?.querySelector<HTMLElement>(":scope > .branch > .tree-node");
      const matrix = svg?.getScreenCTM();
      const tip = matrix && new DOMPoint(tipX as number, 0).matrixTransform(matrix);
      return {
        fullPathVisible: getComputedStyle(path).strokeDasharray === "none",
        tipGap: card && tip ? card.getBoundingClientRect().left - tip.x : Number.NaN
      };
    }), connectorTipX);
  expect(renderedEdges.every(({ fullPathVisible, tipGap }) => fullPathVisible && tipGap >= 0 && tipGap <= 12)).toBe(true);
});
