import { describe, expect, it } from "vitest";
import { meritSlices } from "./distribution";
import type { MeritHolding } from "./state";

const holding = (owner: string, merits: bigint): MeritHolding => ({ owner, merits, lots: [] });

describe("merit distribution", () => {
  it("creates stable pie geometry and percentages", () => {
    const slices = meritSlices([holding("a", 3n), holding("b", 1n)]);
    expect(slices.map(({ percent }) => percent)).toEqual([75, 25]);
    expect(slices[0].path).toContain("A48 48 0 1 1");
    expect(slices[1].path).toContain("A48 48 0 0 1");
  });

  it("handles empty and single-holder distributions", () => {
    expect(meritSlices([])).toEqual([]);
    expect(meritSlices([holding("a", 0n)])).toEqual([]);
    expect(meritSlices([holding("a", 5n)])[0].path).toContain("A48 48 0 1 1");
  });
});
