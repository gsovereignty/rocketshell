import { describe, expect, it } from "vitest";
import { pubkeyAvatarHue, pubkeyAvatarLabel, pubkeyDisplay } from "./avatar";

describe("pubkey avatar", () => {
  it("derives stable presentation without profile metadata", () => {
    const pubkey = "ab".repeat(32);
    expect(pubkeyAvatarLabel(pubkey)).toBe("AB");
    expect(pubkeyAvatarHue(pubkey)).toBe(pubkeyAvatarHue(pubkey));
    expect(pubkeyAvatarHue(pubkey)).toBeGreaterThanOrEqual(0);
    expect(pubkeyAvatarHue(pubkey)).toBeLessThan(360);
  });

  it("renders a stable shortened NIP-19 public key", () => {
    expect(pubkeyDisplay("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"))
      .toBe("npub180cvv07…wsyjh6w6");
  });
});
