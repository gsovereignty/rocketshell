import { describe, expect, it } from "vitest";
import { profileFromEvents } from "./profile";

describe("profile metadata", () => {
  const pubkey = "ab".repeat(32);

  it("uses latest valid display name and picture", () => {
    const profile = profileFromEvents(pubkey, [
      { pubkey, created_at: 1, content: JSON.stringify({ name: "Old name" }) },
      { pubkey, created_at: 2, content: JSON.stringify({ display_name: "Ada", name: "ada", picture: "https://example.com/ada.jpg" }) },
    ]);
    expect(profile).toEqual({ name: "Ada", picture: "https://example.com/ada.jpg" });
  });

  it("falls back through malformed and empty metadata", () => {
    const profile = profileFromEvents(pubkey, [
      { pubkey, created_at: 3, content: "{" },
      { pubkey, created_at: 2, content: JSON.stringify({ name: "  " }) },
      { pubkey, created_at: 1, content: JSON.stringify({ nip05: "ada@example.com" }) },
    ]);
    expect(profile).toEqual({ name: "ada@example.com", picture: undefined });
  });
});
