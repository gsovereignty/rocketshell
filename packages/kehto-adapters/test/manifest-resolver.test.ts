import { describe, expect, it } from "vitest";
import { parseNappletCoordinate } from "../src/index.js";

describe("Napplet manifest coordinates", () => {
  it("parses named NIP-5D coordinates", () => {
    expect(parseNappletCoordinate("35129:266815E0C9210DFA324C6CBA3573B14BEE49DA4209A9456F9484E5106CD408A5:good-morning")).toEqual({
      kind: 35129,
      pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
      identifier: "good-morning"
    });
  });

  it("rejects malformed and unsupported coordinates", () => {
    expect(() => parseNappletCoordinate("good-morning")).toThrow("kind:pubkey:identifier");
    expect(() => parseNappletCoordinate(`35128:${"1".repeat(64)}:good-morning`)).toThrow("Only named kind 35129");
  });
});
