import { describe, expect, it } from "vitest";
import { canPlaceRect, defaultWidgetRects, profileForWidth, rectsOverlap, resolveRelocation } from "./widget-layout.js";

describe("widget grid profiles", () => {
  it("selects container-driven column counts", () => {
    expect(profileForWidth(599).columns).toBe(1);
    expect(profileForWidth(600).columns).toBe(2);
    expect(profileForWidth(900).columns).toBe(4);
    expect(profileForWidth(1400).columns).toBe(6);
  });
});

describe("default widget layouts", () => {
  it("fills width with one window", () => {
    expect(defaultWidgetRects(1, 6)).toEqual([{ column: 0, row: 0, width: 6, height: 2 }]);
  });

  it("places two windows side by side", () => {
    expect(defaultWidgetRects(2, 4)).toEqual([
      { column: 0, row: 0, width: 2, height: 2 },
      { column: 2, row: 0, width: 2, height: 2 }
    ]);
  });

  it("uses a two-by-two grid for three or four windows", () => {
    expect(defaultWidgetRects(3, 6)).toEqual([
      { column: 0, row: 0, width: 3, height: 1 },
      { column: 3, row: 0, width: 3, height: 1 },
      { column: 0, row: 1, width: 3, height: 1 }
    ]);
    expect(defaultWidgetRects(4, 4)[3]).toEqual({ column: 2, row: 1, width: 2, height: 1 });
  });

  it("stacks every mobile window", () => {
    expect(defaultWidgetRects(3, 1)).toEqual([
      { column: 0, row: 0, width: 1, height: 1 },
      { column: 0, row: 1, width: 1, height: 1 },
      { column: 0, row: 2, width: 1, height: 1 }
    ]);
  });
});

describe("widget collision checks", () => {
  it("rejects overlap and out-of-grid placement", () => {
    const occupied = [{ column: 0, row: 0, width: 2, height: 2 }];
    expect(rectsOverlap(occupied[0]!, { column: 1, row: 1, width: 2, height: 1 })).toBe(true);
    expect(canPlaceRect({ column: 2, row: 0, width: 2, height: 2 }, 4, occupied)).toBe(true);
    expect(canPlaceRect({ column: 1, row: 0, width: 2, height: 1 }, 4, occupied)).toBe(false);
    expect(canPlaceRect({ column: 3, row: 0, width: 2, height: 1 }, 4, occupied)).toBe(false);
  });

  it("moves a widget into empty grid cells", () => {
    const rects = [
      { column: 0, row: 0, width: 2, height: 1 },
      { column: 2, row: 0, width: 2, height: 1 }
    ];
    const target = { column: 0, row: 1, width: 2, height: 1 };
    const result = resolveRelocation(0, target, rects, 4);
    expect(result.kind).toBe("move");
    expect(result.updates.get(0)).toEqual(target);
  });

  it("swaps widgets when occupied target has same size", () => {
    const left = { column: 0, row: 0, width: 2, height: 1 };
    const right = { column: 2, row: 0, width: 2, height: 1 };
    const result = resolveRelocation(0, right, [left, right], 4);
    expect(result.kind).toBe("swap");
    expect(result.updates.get(0)).toEqual(right);
    expect(result.updates.get(1)).toEqual(left);
  });

  it("rejects partial and incompatible collisions", () => {
    const moving = { column: 0, row: 0, width: 2, height: 1 };
    const tall = { column: 2, row: 0, width: 2, height: 2 };
    expect(resolveRelocation(0, { ...moving, column: 2 }, [moving, tall], 4).kind).toBe("reject");
    expect(resolveRelocation(0, { ...moving, column: 1 }, [moving, tall], 4).kind).toBe("reject");
    expect(resolveRelocation(0, { ...moving, column: 3 }, [moving, tall], 4).kind).toBe("reject");
  });
});
