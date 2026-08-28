import { describe, expect, it, vi } from "vitest";
import { activateOpenWindow } from "./menu-window-activation";

describe("menu window activation", () => {
  it("shows, focuses, and reveals an existing matching widget without creating another", () => {
    const element = {} as HTMLElement;
    const focus = vi.fn();
    const existing = { identity: { windowId: "window-1" }, element, iframe: { focus } } as never;
    const windows = { findByDTag: vi.fn(() => existing), show: vi.fn() };
    const grid = { reveal: vi.fn() };

    expect(activateOpenWindow(windows, grid, "create-rocket")).toBe(existing);
    expect(windows.findByDTag).toHaveBeenCalledWith("create-rocket");
    expect(windows.show).toHaveBeenCalledWith("window-1");
    expect(grid.reveal).toHaveBeenCalledWith(element);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("leaves unopened widgets for the normal creation path", () => {
    const windows = { findByDTag: vi.fn(() => undefined), show: vi.fn() };
    const grid = { reveal: vi.fn() };
    expect(activateOpenWindow(windows, grid, "navigate-problem-tree")).toBeUndefined();
    expect(windows.show).not.toHaveBeenCalled();
    expect(grid.reveal).not.toHaveBeenCalled();
  });
});
