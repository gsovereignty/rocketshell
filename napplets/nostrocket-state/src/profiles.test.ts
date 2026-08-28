import { describe, expect, it, vi } from "vitest";
import { avatarHue, avatarLabel, holderProfilesFromEvents } from "./profiles";
import type { NostrEvent } from "./state";

const event = (overrides: Partial<NostrEvent>): NostrEvent => ({
  id: "1".repeat(64), pubkey: "a".repeat(64), created_at: 1, kind: 0, tags: [], content: "{}", sig: "2".repeat(128), ...overrides
});

describe("holder profiles", () => {
  it("uses latest metadata and preferred display name", () => {
    const author = "a".repeat(64);
    const profiles = holderProfilesFromEvents([author], [
      event({ created_at: 1, content: JSON.stringify({ name: "Old" }) }),
      event({ id: "0".repeat(64), created_at: 2, content: JSON.stringify({ display_name: "Ada", name: "Fallback", picture: "https://example.test/ada.png" }) })
    ]);
    expect(profiles.get(author)).toEqual({ name: "Ada", picture: "https://example.test/ada.png" });
  });

  it("ignores malformed and unrelated metadata with observable warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const author = "a".repeat(64);
    const profiles = holderProfilesFromEvents([author], [
      event({ content: "{" }),
      event({ pubkey: "b".repeat(64), content: JSON.stringify({ name: "Other" }) })
    ]);
    expect(profiles.size).toBe(0);
    expect(warn).toHaveBeenCalledWith("Ignoring malformed holder profile metadata", expect.objectContaining({ author }));
    warn.mockRestore();
  });

  it("builds deterministic avatar fallbacks", () => {
    expect(avatarLabel("Ada Lovelace", "a".repeat(64))).toBe("AL");
    expect(avatarLabel(undefined, "bc".repeat(32))).toBe("BC");
    expect(avatarHue("a".repeat(64))).toBe(avatarHue("a".repeat(64)));
  });
});
