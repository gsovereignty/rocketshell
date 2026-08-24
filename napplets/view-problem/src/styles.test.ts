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

  it("keeps readable identity fallbacks while GSAP owns shimmer motion", () => {
    expect(main).toContain("pubkeyDisplay(author)");
    expect(main).toContain('gsap.fromTo(names');
    expect(main).toContain('gsap.fromTo(avatars');
    expect(main).toContain("profileLoadingAuthors.delete(author)");
    expect(main).toContain("avatarLoadingAuthors.delete(author)");
    expect(styles).toContain(".profile-name-loading");
    expect(styles).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("starts profile loading when first cached preview renders", () => {
    expect(main).toMatch(/initialPreviewRendered = true;\s+render\(\);\s+void loadProfiles\(\[problem\.owner, result\.event\.pubkey\]\);/);
  });
});
