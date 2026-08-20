import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, THEME_OPTIONS, checkUrl, resolveTheme } from "./settings-view.js";

const normalizeRelay = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.protocol !== "wss:") throw new Error("Relay scheme forbidden");
  return parsed.toString();
};

describe("theme resolution", () => {
  it("follows the operating system only for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("offers exactly the three preferences the store accepts", () => {
    expect(THEME_OPTIONS.map((option) => option.id)).toEqual(["system", "light", "dark"]);
  });
});

describe("tabs", () => {
  it("exposes the three sections with unique ids", () => {
    const ids = SETTINGS_TABS.map((tab) => tab.id);
    expect(ids).toEqual(["appearance", "relays", "media"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("url checking", () => {
  it("normalizes an acceptable address", () => {
    expect(checkUrl("  wss://relay.test  ", normalizeRelay, [])).toEqual({ ok: true, url: "wss://relay.test/" });
  });

  it("reports empty input", () => {
    expect(checkUrl("   ", normalizeRelay, [])).toEqual({ ok: false, error: "Enter an address first." });
  });

  it("surfaces the policy message for a rejected address", () => {
    expect(checkUrl("http://relay.test", normalizeRelay, [])).toEqual({ ok: false, error: "Relay scheme forbidden" });
    expect(checkUrl("not a url", normalizeRelay, []).ok).toBe(false);
  });

  it("rejects a duplicate after normalizing, not just a literal match", () => {
    expect(checkUrl("wss://relay.test", normalizeRelay, ["wss://relay.test/"]))
      .toEqual({ ok: false, error: "That address is already in the list." });
  });

  it("enforces the relay budget before anything is persisted or published", () => {
    const full = ["wss://a.test/", "wss://b.test/"];
    expect(checkUrl("wss://c.test", normalizeRelay, full, 2)).toEqual({ ok: false, error: "This list is limited to 2 entries." });
    expect(checkUrl("wss://c.test", normalizeRelay, full, 3).ok).toBe(true);
    // No limit given means no cap, which is how media servers behave.
    expect(checkUrl("wss://c.test", normalizeRelay, full).ok).toBe(true);
  });
});
