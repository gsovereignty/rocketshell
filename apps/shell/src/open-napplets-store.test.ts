import { describe, expect, it } from "vitest";
import { createOpenNappletsStore } from "./open-napplets-store.js";

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

describe("open napplets store", () => {
  it("persists open coordinates in order, including duplicates", () => {
    const storage = memoryStorage();
    const store = createOpenNappletsStore(storage);
    store.add("naddr1first");
    store.add("naddr1first");
    store.add("naddr1second");
    expect(createOpenNappletsStore(storage).get()).toEqual(["naddr1first", "naddr1first", "naddr1second"]);
  });

  it("removes only one matching window", () => {
    const store = createOpenNappletsStore(memoryStorage());
    store.add("naddr1first");
    store.add("naddr1second");
    store.add("naddr1first");
    store.remove("naddr1first");
    expect(store.get()).toEqual(["naddr1second", "naddr1first"]);
  });

  it("ignores corrupt and invalid saved values", () => {
    const storage = memoryStorage();
    storage.setItem("shell.open-napplets", "not json");
    expect(createOpenNappletsStore(storage).get()).toEqual([]);
    storage.setItem("shell.open-napplets", JSON.stringify(["valid", 3, ""]));
    expect(createOpenNappletsStore(storage).get()).toEqual(["valid"]);
  });
});
