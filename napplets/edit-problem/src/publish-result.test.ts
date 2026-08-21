import { describe, expect, it } from "vitest";
import { revisionPublishMessage } from "./publish-result";

describe("revisionPublishMessage", () => {
  it("reports full publication", () => {
    expect(revisionPublishMessage({
      ok: true,
      event: { id: "a".repeat(64) },
      relays: { "wss://one.example": true },
    })).toBe("Revision published · aaaaaaaaaaaa…");
  });

  it("accepts a signed event published to at least one relay", () => {
    expect(revisionPublishMessage({
      ok: false,
      error: "publish denied",
      event: { id: "b".repeat(64) },
      relays: { "wss://one.example": true, "wss://two.example": false },
    })).toBe("Revision published to 1 of 2 relays · bbbbbbbbbbbb…");
  });

  it("rejects publication when every relay denies it", () => {
    expect(() => revisionPublishMessage({
      ok: false,
      error: "publish denied",
      event: { id: "c".repeat(64) },
      relays: { "wss://one.example": false, "wss://two.example": false },
    })).toThrow("No relay accepted the revision (0 of 2).");
  });
});
