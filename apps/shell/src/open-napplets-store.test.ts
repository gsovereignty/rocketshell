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
    store.add("naddr1first", "first");
    store.add("naddr1first", "first");
    store.add("naddr1second", "second");
    expect(createOpenNappletsStore(storage).get()).toEqual([
      { coordinate: "naddr1first", dTag: "first" },
      { coordinate: "naddr1first", dTag: "first" },
      { coordinate: "naddr1second", dTag: "second" }
    ]);
  });

  it("removes only one matching window", () => {
    const store = createOpenNappletsStore(memoryStorage());
    store.add("naddr1first", "first");
    store.add("naddr1second", "second");
    store.add("naddr1first", "first");
    store.remove("naddr1first");
    expect(store.get()).toEqual([
      { coordinate: "naddr1second", dTag: "second" },
      { coordinate: "naddr1first", dTag: "first" }
    ]);
  });

  it("ignores corrupt and invalid saved values", () => {
    const storage = memoryStorage();
    storage.setItem("shell.open-napplets", "not json");
    expect(createOpenNappletsStore(storage).get()).toEqual([]);
    storage.setItem("shell.open-napplets", JSON.stringify(["valid", 3, ""]));
    expect(createOpenNappletsStore(storage).get()).toEqual([{ coordinate: "valid" }]);
  });

  it("migrates coordinate-only saved values", () => {
    const storage = memoryStorage();
    storage.setItem("shell.open-napplets", JSON.stringify(["naddr1legacy"]));
    expect(createOpenNappletsStore(storage).get()).toEqual([{ coordinate: "naddr1legacy" }]);
  });
});
