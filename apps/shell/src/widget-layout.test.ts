import { describe, expect, it } from "vitest";
import {
  canPlaceRect,
  defaultWidgetRects,
  nextFullscreenRect,
  profileForWidth,
  rectsOverlap,
  resolveOpeningPlacement,
  resolveRelocation,
  snapPageStartRows,
  transferReplacementRect,
  visibleGridRange
} from "./widget-layout.js";

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
    expect(defaultWidgetRects(1, 1)).toEqual([{ column: 0, row: 0, width: 1, height: 2 }]);
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

describe("viewport snap pages", () => {
  it("creates one desktop snap point for every two occupied rows", () => {
    expect(snapPageStartRows([
      { column: 0, row: 0, width: 2, height: 2 },
      { column: 0, row: 2, width: 2, height: 1 },
      { column: 2, row: 4, width: 2, height: 1 }
    ], 2)).toEqual([0, 2, 4]);
  });

  it("creates one mobile snap point per occupied row", () => {
    expect(snapPageStartRows([
      { column: 0, row: 0, width: 1, height: 1 },
      { column: 0, row: 1, width: 1, height: 2 }
    ], 1)).toEqual([0, 1, 2]);
    expect(snapPageStartRows([], 1)).toEqual([]);
  });
});

describe("fullscreen widget placement", () => {
  it("expands in its current page when peers leave it empty", () => {
    expect(nextFullscreenRect(
      { column: 2, row: 2, width: 2, height: 1 },
      [{ column: 0, row: 0, width: 4, height: 2 }],
      4,
      2
    )).toEqual({ column: 0, row: 2, width: 4, height: 2 });
  });

  it("uses next empty screen without moving other widgets", () => {
    expect(nextFullscreenRect(
      { column: 0, row: 0, width: 2, height: 1 },
      [
        { column: 2, row: 0, width: 2, height: 1 },
        { column: 0, row: 2, width: 1, height: 1 }
      ],
      4,
      2
    )).toEqual({ column: 0, row: 4, width: 4, height: 2 });
  });

  it("fills one row per mobile screen", () => {
    expect(nextFullscreenRect(
      { column: 0, row: 0, width: 1, height: 1 },
      [{ column: 0, row: 1, width: 1, height: 1 }],
      1,
      1
    )).toEqual({ column: 0, row: 0, width: 1, height: 1 });
  });
});

describe("widget collision checks", () => {
  it("transfers a caller slot without moving unrelated widgets", () => {
    const caller = { id: "caller" };
    const target = { id: "target" };
    const peer = { id: "peer" };
    const callerRect = { column: 0, row: 0, width: 2, height: 2 };
    const peerRect = { column: 2, row: 0, width: 2, height: 2 };
    const rects = new Map([[caller, callerRect], [peer, peerRect]]);

    expect(transferReplacementRect(rects, target, caller)).toBe(callerRect);
    expect(rects.get(target)).toBe(callerRect);
    expect(rects.has(caller)).toBe(false);
    expect(rects.get(peer)).toBe(peerRect);
  });

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

  it("packs incompatible collisions into earliest available cells", () => {
    const moving = { column: 0, row: 0, width: 2, height: 1 };
    const tall = { column: 2, row: 0, width: 2, height: 2 };
    const result = resolveRelocation(0, { ...moving, column: 2 }, [moving, tall], 4);
    expect(result.kind).toBe("pack");
    expect(result.updates.get(0)).toEqual({ ...moving, column: 2 });
    expect(result.updates.get(1)).toEqual({ column: 0, row: 0, width: 2, height: 2 });
  });

  it("packs every widget displaced by a larger target", () => {
    const moving = { column: 0, row: 2, width: 2, height: 2 };
    const cells = [
      { column: 0, row: 0, width: 1, height: 1 },
      { column: 1, row: 0, width: 1, height: 1 },
      { column: 0, row: 1, width: 1, height: 1 },
      { column: 1, row: 1, width: 1, height: 1 }
    ];
    const result = resolveRelocation(0, { ...moving, row: 0 }, [moving, ...cells], 4);
    expect(result.kind).toBe("pack");
    expect([...result.updates.values()]).toEqual([
      { column: 0, row: 0, width: 2, height: 2 },
      { column: 2, row: 0, width: 1, height: 1 },
      { column: 3, row: 0, width: 1, height: 1 },
      { column: 2, row: 1, width: 1, height: 1 },
      { column: 3, row: 1, width: 1, height: 1 }
    ]);
  });

  it("rejects targets outside the grid", () => {
    const moving = { column: 0, row: 0, width: 2, height: 1 };
    const tall = { column: 2, row: 0, width: 2, height: 2 };
    expect(resolveRelocation(0, { ...moving, column: 3 }, [moving, tall], 4).kind).toBe("reject");
  });
});

describe("viewport-first widget opening", () => {
  const visibleRows = { startRow: 0, endRow: 2 };

  it("uses a free full-size slot inside the visible viewport", () => {
    const occupied = [{ column: 0, row: 0, width: 2, height: 2 }];
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 2, height: 2 },
      occupied,
      4,
      visibleRows
    );
    expect(placement.kind).toBe("visible");
    expect(placement.rect).toEqual({ column: 2, row: 0, width: 2, height: 2 });
  });

  it("ignores an available stored placement below the viewport", () => {
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 2, height: 1 },
      [],
      4,
      visibleRows,
      { column: 0, row: 8, width: 2, height: 1 }
    );
    expect(placement.kind).toBe("visible");
    expect(placement.rect.row).toBe(0);
  });

  it("restores valid stored geometry with a different size than the default", () => {
    const preferred = { column: 1, row: 1, width: 2, height: 1 };
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 4, height: 2 },
      [],
      4,
      visibleRows,
      preferred
    );
    expect(placement.kind).toBe("visible");
    expect(placement.rect).toBe(preferred);
  });

  it("uses rows belonging to the current scrolled viewport", () => {
    const rows = visibleGridRange(-460, 0, 500, 220, 10);
    expect(rows).toEqual({ startRow: 2, endRow: 4 });
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 2, height: 1 },
      [],
      4,
      rows
    );
    expect(placement.rect.row).toBe(2);
  });

  it("repacks a conflicting window before growing the page", () => {
    const occupied = [
      { column: 0, row: 0, width: 2, height: 1 },
      { column: 2, row: 0, width: 1, height: 1 }
    ];
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 2, height: 2 },
      occupied,
      4,
      visibleRows
    );
    expect(placement.kind).toBe("repacked");
    expect(placement.rect).toEqual({ column: 0, row: 0, width: 2, height: 2 });
    expect(placement.updates.get(0)).toEqual({ column: 2, row: 1, width: 2, height: 1 });
  });

  it("reduces the new window to legal minimum size before growing the page", () => {
    const occupied = [{ column: 0, row: 0, width: 3, height: 2 }];
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 2, height: 2 },
      occupied,
      4,
      visibleRows
    );
    expect(placement.kind).toBe("reduced");
    expect(placement.rect).toEqual({ column: 3, row: 0, width: 1, height: 1 });
  });

  it("overflows only when no visible grid cell remains", () => {
    const occupied = [{ column: 0, row: 0, width: 4, height: 2 }];
    const placement = resolveOpeningPlacement(
      { column: 0, row: 0, width: 2, height: 2 },
      occupied,
      4,
      visibleRows
    );
    expect(placement.kind).toBe("overflow");
    expect(placement.rect.row).toBe(2);
  });

  it("recalculates visible capacity after viewport resize", () => {
    expect(visibleGridRange(80, 0, 800, 220, 10)).toEqual({ startRow: 0, endRow: 3 });
    expect(visibleGridRange(80, 0, 500, 220, 10)).toEqual({ startRow: 0, endRow: 1 });
  });
});
