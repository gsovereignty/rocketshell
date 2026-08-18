import { describe, expect, it } from "vitest";
import { createStorageConfigStore } from "../src/index.js";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

describe("durable config store", () => {
  it("persists values across store instances and isolates scopes", () => {
    const storage = memoryStorage();
    createStorageConfigStore(storage).set("alice:napplet:hash-a", { color: "blue" });
    expect(createStorageConfigStore(storage).get("alice:napplet:hash-a")).toEqual({ color: "blue" });
    expect(createStorageConfigStore(storage).get("bob:napplet:hash-a")).toEqual({});
    expect(createStorageConfigStore(storage).get("alice:napplet:hash-b")).toEqual({});
  });

  it("treats malformed persisted values as empty", () => {
    const storage = memoryStorage();
    storage.setItem("platform:config:v1:broken", "[");
    expect(createStorageConfigStore(storage).get("broken")).toEqual({});
  });
});
