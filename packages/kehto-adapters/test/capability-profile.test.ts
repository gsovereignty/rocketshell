import { describe, expect, it } from "vitest";
import { resolveCapabilityProfile } from "../src/index.js";

describe("capability profile", () => {
  it("can narrow wired domains but never add unwired domains", () => {
    const result = resolveCapabilityProfile({ wired: ["shell", "relay", "identity"], policy: ["shell", "relay"], required: ["shell", "relay", "resource"], granted: ["shell", "relay", "resource"], consented: ["shell", "relay", "resource"] });
    expect(result).toEqual(["shell", "relay"]); expect(result).not.toContain("resource");
  });
});
