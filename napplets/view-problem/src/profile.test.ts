import { describe, expect, it } from "vitest";
import { profileDisplayName, profileInitials } from "./profile";

const pubkey = "a".repeat(64);

describe("comment profiles", () => {
  it("prefers display name over legacy name", () =>
    expect(profileDisplayName({ displayName: "Maria K.", name: "maria" }, pubkey)).toBe("Maria K."));
  it("falls back through name to shortened pubkey", () => {
    expect(profileDisplayName({ name: "maria" }, pubkey)).toBe("maria");
    expect(profileDisplayName(undefined, pubkey)).toBe("aaaaaaaa…aaaaa");
  });
  it("derives initials from resolved profile names", () => {
    expect(profileInitials("Maria K.")).toBe("MK");
    expect(profileInitials("maria")).toBe("MA");
  });
});
