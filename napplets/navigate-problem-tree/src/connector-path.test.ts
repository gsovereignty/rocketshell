import { describe, expect, it } from "vitest";
import { connectorPathData, connectorTipX, connectorWidth } from "./connector-path";

const coordinates = ["31971:owner:root", "31971:owner:child", "31971:owner:deep-branch", "31971:owner:zzz"];
const heights = [23, 46, 71, 95, 160];
const samples = coordinates.flatMap((coordinate) => heights.map((y) => ({ coordinate, y, d: connectorPathData(coordinate, y) })));

describe("connector geometry", () => {
  it("uses straight SVG commands joined at one right angle", () => {
    for (const { d } of samples) expect(d).toMatch(/^M 1 0 V \d+(?:\.\d+)? H 24$/);
  });

  it("is one continuous path without separate segments", () => {
    for (const { d } of samples) {
      expect(d.match(/M/g)).toHaveLength(1);
      expect(d.match(/V/g)).toHaveLength(1);
      expect(d.match(/H/g)).toHaveLength(1);
      expect(d.startsWith("M 1 0")).toBe(true);
    }
  });

  it("keeps line endpoint inside gutter", () => {
    expect(connectorTipX).toBeLessThan(connectorWidth);
    expect(connectorTipX - 1).toBeGreaterThanOrEqual(20);
  });

  it("terminates the branch at the gutter edge", () => {
    for (const { d } of samples) expect(d.endsWith(`H ${connectorTipX}`)).toBe(true);
  });

  it("is deterministic and geometry depends only on layout", () => {
    expect(connectorPathData("31971:owner:a", 40)).toBe(connectorPathData("31971:owner:a", 40));
    expect(connectorPathData("31971:owner:a", 40)).toBe(connectorPathData("31971:owner:b", 40));
  });
});
