import { describe, expect, it } from "vitest";
import { createIntentPreferenceStore } from "../src/index.js";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

describe("intent preferences", () => {
  it("isolates defaults by account and archetype", () => {
    const store = createIntentPreferenceStore(memoryStorage());
    store.set("alice", "profile", "viewer-a");
    expect(store.get("alice", "profile")).toBe("viewer-a");
    expect(store.get("bob", "profile")).toBeUndefined();
    expect(store.get("alice", "article")).toBeUndefined();
  });
});
