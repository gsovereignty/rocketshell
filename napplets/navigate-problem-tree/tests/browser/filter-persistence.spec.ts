import { expect, test } from "@playwright/test";

const owner = "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075";
const hex = (character: string) => character.repeat(64);
const coordinate = (character: string) => `31971:${owner}:${hex(character)}`;
const root = `31971:${owner}:7cff61a9f7565ed63c1213040fe0f39c7f2ee1dd4fb96a41e95de049a8dcc170`;

const problem = (character: string, title: string, status: string, parent?: string, problemCoordinate = coordinate(character)) => {
  return {
    event: {
      id: hex(character),
      pubkey: owner,
      kind: 31971,
      created_at: 1,
      content: "",
      sig: hex("f"),
      tags: [
        ["d", problemCoordinate.split(":")[2]],
        ["title", title],
        ["status", status],
        ["a", problemCoordinate, "", "origin"],
        ["A", root, ""],
        ...(parent ? [["a", parent, ""]] : [])
      ]
    },
    sidecar: { relayHints: [] }
  };
};

const firstParent = coordinate("2");
const secondParent = coordinate("5");
const events = [
  problem("1", "Root", "open", undefined, root),
  problem("2", "First parent", "open", root),
  problem("3", "First open leaf", "open", firstParent),
  problem("4", "First closed leaf", "closed", firstParent),
  problem("5", "Second parent", "open", root),
  problem("6", "Second open leaf", "open", secondParent),
  problem("7", "Second closed leaf", "closed", secondParent)
];

test("status filter remains active when navigating between parents", async ({ page }) => {
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
  await page.locator(`.tree-node[data-select="${firstParent}"]`).click();
  await page.locator('[data-filter="open"]').click();
  await expect(page.locator('[data-filter="open"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".problem-row")).toHaveCount(1);
  await expect(page.locator(".row-title")).toHaveText("First open leaf");

  await page.locator(`.tree-node[data-select="${secondParent}"]`).click();

  await expect(page.locator('[data-filter="open"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-filter="all"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".problem-row")).toHaveCount(1);
  await expect(page.locator(".row-title")).toHaveText("Second open leaf");
  await expect(page.getByText("Second closed leaf")).toHaveCount(0);
});

test("title search filters leaf nodes and combines with status", async ({ page }) => {
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
  await page.locator(`.tree-node[data-select="${firstParent}"]`).click();

  const search = page.getByLabel("Filter by title");
  await search.fill("  CLOSED  ");
  await expect(page.locator(".problem-row")).toHaveCount(1);
  await expect(page.locator(".row-title")).toHaveText("First closed leaf");

  await page.locator('[data-filter="open"]').click();
  await expect(page.locator(".problem-row")).toHaveCount(0);
  await expect(page.locator(".empty")).toHaveText("No leaf problems match this search and status filter.");

  await page.locator('[data-filter="closed"]').click();
  await expect(page.locator(".row-title")).toHaveText("First closed leaf");

  await page.locator(`.tree-node[data-select="${secondParent}"]`).click();
  await expect(search).toHaveValue("  CLOSED  ");
  await expect(page.locator('[data-filter="closed"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".row-title")).toHaveText("Second closed leaf");
});
