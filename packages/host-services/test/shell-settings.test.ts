import { describe, expect, it, vi } from "vitest";
import { SHELL_SETTINGS_KEY, createShellSettingsStore, type ShellSettings } from "../src/index.js";

const DEFAULTS: ShellSettings = {
  theme: "system",
  backupRelays: ["wss://relay.example/"],
  lookupRelays: ["wss://lookup.example/"],
  backupBlossomServers: ["https://blossom.example/"]
};

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => { values.delete(key); }
  };
}

describe("shell settings store", () => {
  it("persists updates across store instances", () => {
    const storage = memoryStorage();
    createShellSettingsStore(storage, DEFAULTS).update({ theme: "light", lookupRelays: ["wss://a.example/"] });
    const reloaded = createShellSettingsStore(storage, DEFAULTS).get();
    expect(reloaded.theme).toBe("light");
    expect(reloaded.lookupRelays).toEqual(["wss://a.example/"]);
    // Untouched fields keep the shipped defaults.
    expect(reloaded.backupRelays).toEqual(DEFAULTS.backupRelays);
  });

  it("respects a stored empty list but falls back for a missing key", () => {
    const storage = memoryStorage();
    createShellSettingsStore(storage, DEFAULTS).update({ backupRelays: [] });
    expect(createShellSettingsStore(storage, DEFAULTS).get().backupRelays).toEqual([]);

    storage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "dark" }));
    expect(createShellSettingsStore(storage, DEFAULTS).get().backupRelays).toEqual(DEFAULTS.backupRelays);
  });

  it("falls back to defaults for malformed or hostile persisted values", () => {
    const storage = memoryStorage();
    storage.setItem(SHELL_SETTINGS_KEY, "[");
    expect(createShellSettingsStore(storage, DEFAULTS).get()).toEqual(DEFAULTS);

    storage.setItem(SHELL_SETTINGS_KEY, JSON.stringify({ theme: "neon", lookupRelays: [1, null, "wss://ok.example/", "wss://ok.example/", "  "] }));
    const settings = createShellSettingsStore(storage, DEFAULTS).get();
    expect(settings.theme).toBe("system");
    expect(settings.lookupRelays).toEqual(["wss://ok.example/"]);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = createShellSettingsStore(memoryStorage(), DEFAULTS);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.update({ theme: "dark" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update({ theme: "light" });
    expect(listener).toHaveBeenCalledTimes(1);
  });


  it("reset clears storage and returns the shipped defaults", () => {
    const storage = memoryStorage();
    const store = createShellSettingsStore(storage, DEFAULTS);
    store.update({ theme: "dark", backupRelays: [] });
    expect(store.reset()).toEqual(DEFAULTS);
    expect(storage.getItem(SHELL_SETTINGS_KEY)).toBeNull();
    expect(createShellSettingsStore(storage, DEFAULTS).get()).toEqual(DEFAULTS);
  });
});
