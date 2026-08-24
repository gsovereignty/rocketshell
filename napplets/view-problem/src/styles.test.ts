import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("discussion layout", () => {
  it("limits activity-row grids to direct discussion entries", () => {
    expect(styles).toContain(".discussion > ol > li { display:grid");
    expect(styles).not.toMatch(/\.discussion li\s*\{/);
  });

  it("does not apply the narrow activity grid to Markdown list items", () => {
    expect(styles).toContain(".markdown-body li + li");
    expect(styles).not.toMatch(/\.discussion li\s*>\s*div/);
  });

  it("does not render a related-problems section", () => {
    expect(main).not.toContain('<section class="related"');
  });
});
