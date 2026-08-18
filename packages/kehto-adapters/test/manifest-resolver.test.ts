import { describe, expect, it } from "vitest";
import { parseNappletCoordinate } from "../src/index.js";

describe("Napplet manifest coordinates", () => {
  const naddr = "naddr1qqxxwmm0vskk6mmjde5kueczyqnxs90qeyssm73jf3kt5dtnk997ujw6ggy6j3t0jjzw2yrv6sy22qcyqqqgjwg7c0wh8";
  const expected = {
    kind: 35129,
    pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    identifier: "good-morning"
  };

  it("parses named NIP-5D coordinates", () => {
    expect(parseNappletCoordinate("35129:266815E0C9210DFA324C6CBA3573B14BEE49DA4209A9456F9484E5106CD408A5:good-morning")).toEqual(expected);
  });

  it("parses bare and NIP-21-prefixed naddr pointers", () => {
    expect(parseNappletCoordinate(naddr)).toEqual(expected);
    expect(parseNappletCoordinate(`nostr:${naddr}`)).toEqual(expected);
  });

  it("rejects malformed and unsupported coordinates", () => {
    expect(() => parseNappletCoordinate("good-morning")).toThrow("naddr or kind:pubkey:identifier");
    expect(() => parseNappletCoordinate(`35128:${"1".repeat(64)}:good-morning`)).toThrow("Only named kind 35129");
  });
});
