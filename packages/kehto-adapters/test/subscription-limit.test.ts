import type { ServiceHandler } from "@kehto/runtime";
import { describe, expect, it, vi } from "vitest";
import { limitServiceSubscriptions } from "../src/index.js";

describe("service subscription limits", () => {
  it("bounds each window and releases slots on close and destruction", () => {
    const handleMessage = vi.fn(); const onWindowDestroyed = vi.fn();
    const handler = { descriptor: { name: "relay", version: "1" }, handleMessage, onWindowDestroyed } as ServiceHandler;
    const limited = limitServiceSubscriptions(handler, { subscribe: "relay.subscribe", close: "relay.close", closed: "relay.closed" }, 2);
    const send = vi.fn();
    limited.handleMessage("window-1", { type: "relay.subscribe", subId: "one" } as never, send);
    limited.handleMessage("window-1", { type: "relay.subscribe", subId: "two" } as never, send);
    limited.handleMessage("window-1", { type: "relay.subscribe", subId: "three" } as never, send);
    expect(handleMessage).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ type: "relay.closed", subId: "three", reason: "subscription-limit" });
    limited.handleMessage("window-1", { type: "relay.close", subId: "one" } as never, send);
    limited.handleMessage("window-1", { type: "relay.subscribe", subId: "three" } as never, send);
    expect(handleMessage).toHaveBeenCalledTimes(4);
    limited.onWindowDestroyed?.("window-1");
    limited.handleMessage("window-1", { type: "relay.subscribe", subId: "four" } as never, send);
    expect(onWindowDestroyed).toHaveBeenCalledWith("window-1");
    expect(handleMessage).toHaveBeenCalledTimes(5);
  });
});
