import { describe, expect, it } from "vitest";
import { publishSuccessMessage } from "./publish-result";

const event = { id: "ab".repeat(32) };

describe("publishSuccessMessage", () => {
  it("reports partial relay acceptance as a successful publish", () => {
    expect(publishSuccessMessage({
      ok: false,
      event,
      relays: { "wss://one.example/": true, "wss://two.example/": false },
      error: "publish denied"
    })).toBe("Published to 1 of 2 relays · abababababab…");
  });

  it("preserves failure when no relay accepts the event", () => {
    expect(() => publishSuccessMessage({
      ok: false,
      event,
      relays: { "wss://one.example/": false },
      error: "publish denied"
    })).toThrow("publish denied");
  });
});
