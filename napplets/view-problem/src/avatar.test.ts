import { describe, expect, it } from "vitest";
import { pubkeyAvatarHue, pubkeyAvatarLabel } from "./avatar";

describe("pubkey avatar", () => {
  it("derives stable presentation without profile metadata", () => {
    const pubkey = "ab".repeat(32);
    expect(pubkeyAvatarLabel(pubkey)).toBe("AB");
    expect(pubkeyAvatarHue(pubkey)).toBe(pubkeyAvatarHue(pubkey));
    expect(pubkeyAvatarHue(pubkey)).toBeGreaterThanOrEqual(0);
    expect(pubkeyAvatarHue(pubkey)).toBeLessThan(360);
  });
});
