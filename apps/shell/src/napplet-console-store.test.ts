import { describe, expect, it, vi } from "vitest";
import { NAPPLET_CONSOLE_MESSAGE, createNappletConsoleStore, parseNappletConsoleMessage } from "./napplet-console-store.js";

const message = (value: string, level: "log" | "error" = "log") => ({ type: NAPPLET_CONSOLE_MESSAGE, level, timestamp: 100, args: [value] } as const);

describe("napplet console store", () => {
  it("keeps instance logs separate and bounded", () => {
    const store = createNappletConsoleStore(2);
    store.append("first", message("one"));
    store.append("second", message("other"));
    store.append("first", message("two"));
    store.append("first", message("three"));
    expect(store.list("first").map((entry) => entry.args[0])).toEqual(["two", "three"]);
    expect(store.list("second").map((entry) => entry.args[0])).toEqual(["other"]);
  });

  it("notifies subscribers and clears only requested instance", () => {
    const store = createNappletConsoleStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.append("first", message("one"));
    store.append("second", message("two"));
    store.clear("first");
    expect(store.list("first")).toEqual([]);
    expect(store.list("second")).toHaveLength(1);
    expect(listener).toHaveBeenLastCalledWith("first");
  });

  it("accepts only bounded-prelude message shape and never trusts an identity field", () => {
    expect(parseNappletConsoleMessage({ ...message("ok"), windowId: "forged" })).toEqual(message("ok"));
    expect(parseNappletConsoleMessage({ ...message("bad"), level: "fatal" })).toBeUndefined();
    expect(parseNappletConsoleMessage({ ...message("bad"), args: [{}] })).toBeUndefined();
    expect(parseNappletConsoleMessage({ ...message("bad"), timestamp: Infinity })).toBeUndefined();
    expect(parseNappletConsoleMessage({ ...message("bad"), args: Array(42).fill("x") })).toBeUndefined();
    expect(parseNappletConsoleMessage({ ...message("bad"), args: ["x".repeat(4_001)] })).toBeUndefined();
  });
});
