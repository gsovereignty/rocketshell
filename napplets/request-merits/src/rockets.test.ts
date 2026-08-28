import { describe, expect, it, vi } from "vitest";
import type { NostrEvent } from "@napplet/sdk";
import { NOSTROCKET_AUTHOR, NOSTROCKET_COORDINATE, avatarLabel, profilesFromEvents, rocketsFromEvents } from "./rockets";

const event = (changes: Partial<NostrEvent> = {}): NostrEvent => ({
  id: "1".repeat(64), pubkey: "2".repeat(64), kind: 31108, created_at: 1,
  tags: [["d", "Other Rocket"]], content: "", sig: "3".repeat(128), ...changes
});

describe("rocket choices", () => {
  it("always puts the confirmed NOSTROCKET coordinate first", () => {
    const rockets = rocketsFromEvents([event()]);
    expect(rockets[0]).toMatchObject({ coordinate: NOSTROCKET_COORDINATE, name: "NOSTROCKET", author: NOSTROCKET_AUTHOR });
  });
  it("deduplicates addressable events at their newest revision", () => {
    const rockets = rocketsFromEvents([event({ id: "4".repeat(64), created_at: 2 }), event({ id: "5".repeat(64), created_at: 3 })]);
    expect(rockets.find(({ name }) => name === "Other Rocket")?.event?.id).toBe("5".repeat(64));
  });
  it("ignores malformed rocket events", () => {
    expect(rocketsFromEvents([event({ tags: [] }), event({ pubkey: "bad" })])).toHaveLength(1);
  });
  it("uses newest valid kind-zero author profile", () => {
    const author = "a".repeat(64);
    const profiles = profilesFromEvents([
      event({ kind: 0, pubkey: author, created_at: 1, content: JSON.stringify({ name: "Old" }) }),
      event({ kind: 0, pubkey: author, created_at: 2, content: JSON.stringify({ display_name: "New", picture: "https://example.com/a.png" }) })
    ]);
    expect(profiles.get(author)).toEqual({ name: "New", picture: "https://example.com/a.png" });
  });
  it("reports malformed profiles and supplies compact avatar labels", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    profilesFromEvents([event({ kind: 0, content: "{" })]);
    expect(warn).toHaveBeenCalledWith("Rocket author profile could not be parsed", expect.objectContaining({ eventId: "1".repeat(64) }));
    expect(avatarLabel("Other Rocket")).toBe("OR");
    warn.mockRestore();
  });
});
