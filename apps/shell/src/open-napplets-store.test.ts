import { describe, expect, it, vi } from "vitest";
import { createWindowSessionStore, type WindowSession } from "./open-napplets-store.js";

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
};

const session: WindowSession = {
  version: 2,
  windows: [
    { windowId: "tree-1", dTag: "navigate-problem-tree", launch: { type: "direct", coordinate: "tree-coordinate" }, hidden: true },
    {
      windowId: "viewer-1", dTag: "problem-viewer", hidden: false, replacesWindowId: "tree-1",
      launch: {
        type: "intent", sender: "navigate-problem-tree", convention: "napplet:note/open",
        payload: { target: { type: "event", id: "problem-id" } }
      }
    }
  ],
  focusedWindowId: "viewer-1"
};

describe("window session store", () => {
  it("preserves adjacent DAG and viewer order across refresh", () => {
    const storage = memoryStorage();
    const adjacent: WindowSession = {
      version: 2,
      windows: [
        { windowId: "tree-1", dTag: "navigate-problem-tree", launch: { type: "direct", coordinate: "tree-coordinate" }, hidden: false },
        {
          windowId: "viewer-1", dTag: "problem-viewer", hidden: false,
          launch: {
            type: "intent", sender: "navigate-problem-tree", convention: "napplet:note/open",
            payload: { target: { type: "event", id: "problem-id" } }
          }
        }
      ]
    };
    createWindowSessionStore(storage).set(adjacent);
    expect(createWindowSessionStore(storage).get()).toEqual(adjacent);
    expect(createWindowSessionStore(storage).get().windows.map(({ dTag }) => dTag)).toEqual([
      "navigate-problem-tree", "problem-viewer"
    ]);
  });

  it("drops stale replacement state when DAG and viewer are both visible", () => {
    const storage = memoryStorage();
    storage.setItem("shell.window-session.v2", JSON.stringify({
      version: 2,
      windows: [
        { windowId: "tree-1", dTag: "navigate-problem-tree", launch: { type: "direct", coordinate: "tree-coordinate" }, hidden: false },
        {
          windowId: "viewer-1", dTag: "problem-viewer", hidden: false, replacesWindowId: "tree-1",
          launch: {
            type: "intent", sender: "navigate-problem-tree", convention: "napplet:note/open",
            payload: { target: { type: "event", id: "problem-id" } }
          }
        }
      ]
    }));
    expect(createWindowSessionStore(storage).get().windows).toEqual([
      { windowId: "tree-1", dTag: "navigate-problem-tree", launch: { type: "direct", coordinate: "tree-coordinate" }, hidden: false },
      {
        windowId: "viewer-1", dTag: "problem-viewer", hidden: false,
        launch: {
          type: "intent", sender: "navigate-problem-tree", convention: "napplet:note/open",
          payload: { target: { type: "event", id: "problem-id" } }
        }
      }
    ]);
  });

  it("persists direct and intent-created windows with focus state", () => {
    const storage = memoryStorage();
    createWindowSessionStore(storage).set(session);
    expect(createWindowSessionStore(storage).get()).toEqual(session);
  });

  it("ignores corrupt session entries while retaining valid windows", () => {
    const storage = memoryStorage();
    storage.setItem("shell.window-session.v2", JSON.stringify({
      version: 2,
      windows: [session.windows[0], { windowId: "bad", dTag: 3, launch: null }],
      focusedWindowId: "tree-1"
    }));
    expect(createWindowSessionStore(storage).get()).toEqual({
      version: 2, windows: [session.windows[0]], focusedWindowId: "tree-1"
    });
  });

  it("migrates legacy direct windows and removes legacy storage on save", () => {
    const storage = memoryStorage();
    storage.setItem("shell.open-napplets", JSON.stringify([
      { coordinate: "tree-coordinate", dTag: "navigate-problem-tree" }
    ]));
    const store = createWindowSessionStore(storage);
    expect(store.get()).toEqual({
      version: 2,
      windows: [{
        windowId: "legacy-0", dTag: "navigate-problem-tree",
        launch: { type: "direct", coordinate: "tree-coordinate" }, hidden: false
      }]
    });
    store.set(store.get());
    expect(storage.getItem("shell.open-napplets")).toBeNull();
  });

  it("retains coordinate-only legacy windows for launcher resolution", () => {
    const storage = memoryStorage();
    storage.setItem("shell.open-napplets", JSON.stringify(["tree-coordinate"]));
    expect(createWindowSessionStore(storage).get()).toEqual({
      version: 2,
      windows: [{
        windowId: "legacy-0", launch: { type: "direct", coordinate: "tree-coordinate" }, hidden: false
      }]
    });
  });

  it("reports storage failures without breaking startup", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storage = memoryStorage();
    storage.getItem = () => { throw new Error("blocked"); };
    expect(createWindowSessionStore(storage).get()).toEqual({ version: 2, windows: [] });
    expect(warn).toHaveBeenCalledWith("Unable to read saved Napplet window session", expect.any(Error));
    warn.mockRestore();
  });
});
