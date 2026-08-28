import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shell menu bar", () => {
  const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8");

  it("keeps profile menu leftmost and places New Rocket after it", () => {
    const cluster = html.slice(html.indexOf('<div class="menu-cluster">'), html.indexOf('<div id="account-popover"'));
    expect(cluster.indexOf('id="profile-menu-trigger"')).toBeGreaterThan(-1);
    expect(cluster.indexOf('id="profile-menu-trigger"')).toBeLessThan(cluster.indexOf('id="new-rocket-trigger"'));
    expect(cluster.indexOf('id="new-rocket-trigger"')).toBeLessThan(cluster.indexOf('id="dag-viewer-trigger"'));
    expect(cluster).toContain(">NEW ROCKET</button>");
  });
});
