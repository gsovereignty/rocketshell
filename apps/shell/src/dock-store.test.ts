import { describe, expect, it } from "vitest";
import { createDockStore } from "./dock-store.js";

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

describe("dock store", () => {
  it("pins once in user order and unpins without affecting other launchers", () => {
    const store = createDockStore(memoryStorage());
    store.pin("naddr1first");
    store.pin("naddr1second");
    store.pin("naddr1first");
    expect(store.get()).toEqual(["naddr1first", "naddr1second"]);
    expect(store.has("naddr1first")).toBe(true);
    store.unpin("naddr1first");
    expect(store.get()).toEqual(["naddr1second"]);
  });

  it("ignores corrupt persisted values", () => {
    const storage = memoryStorage();
    storage.setItem("shell.pinned-napplets", JSON.stringify(["naddr1valid", 7, "", "naddr1valid"]));
    expect(createDockStore(storage).get()).toEqual(["naddr1valid"]);
    storage.setItem("shell.pinned-napplets", "not json");
    expect(createDockStore(storage).get()).toEqual([]);
  });
});
