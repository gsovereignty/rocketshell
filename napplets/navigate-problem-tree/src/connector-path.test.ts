import { describe, expect, it } from "vitest";
import { connectorPathData, connectorTipX, connectorWidth } from "./connector-path";

const coordinates = ["31971:owner:root", "31971:owner:child", "31971:owner:deep-branch", "31971:owner:zzz"];
const heights = [23, 46, 71, 95, 160];
const samples = coordinates.flatMap((coordinate) => heights.map((y) => ({ coordinate, y, d: connectorPathData(coordinate, y) })));

const points = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(([, x, valueY]) => ({ x: Number(x), y: Number(valueY) }));

describe("connector geometry", () => {
  it("uses only curves — no straight-line commands", () => {
    for (const { d } of samples) expect(d).not.toMatch(/[LlHhVvSsTtQqAaZz]/);
  });

  it("is one continuous path with a single move and two curves", () => {
    for (const { d } of samples) {
      expect(d.match(/M/g)).toHaveLength(1);
      expect(d.match(/C/g)).toHaveLength(2);
      expect(d.startsWith("M 1 0")).toBe(true);
    }
  });

  it("has no arrowhead returning from the branch endpoint", () => {
    for (const { d } of samples) {
      expect(points(d).filter(({ x }) => x === connectorTipX)).toHaveLength(1);
    }
  });

  it("keeps every point inside the gutter so no ink lands under a card", () => {
    for (const { d } of samples) {
      for (const { x } of points(d)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(connectorTipX);
      }
    }
    expect(connectorTipX).toBeLessThan(connectorWidth);
  });

  it("terminates the branch at the gutter edge", () => {
    for (const { y, d } of samples) expect(d).toContain(`${connectorTipX} ${y}`);
  });

  it("is deterministic per coordinate and varies between coordinates", () => {
    expect(connectorPathData("31971:owner:a", 40)).toBe(connectorPathData("31971:owner:a", 40));
    expect(connectorPathData("31971:owner:a", 40)).not.toBe(connectorPathData("31971:owner:b", 40));
  });

  it("bows further as the drop grows, and stays bounded", () => {
    const stem = (y: number) => connectorPathData("31971:owner:a", y).split("C")[1];
    const bowFor = (y: number) => Math.max(...points(stem(y)).map((point) => point.x));
    expect(bowFor(95)).toBeGreaterThan(bowFor(23));
    expect(bowFor(400)).toBeLessThanOrEqual(connectorTipX);
  });
});
