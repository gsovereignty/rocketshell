import { describe, expect, it } from "vitest";
import type { NostrEvent, RelayEventResult } from "@napplet/sdk";
import { mergeProblemEvents } from "./problem-events";

const hex = (char: string) => char.repeat(64);
const result = (id: string): RelayEventResult => ({
  event: {
    id,
    pubkey: hex("a"),
    kind: 31971,
    created_at: 1,
    content: "",
    tags: [],
    sig: hex("f")
  } satisfies NostrEvent
});

describe("problem event stream", () => {
  it("adds newly published events", () => {
    const first = result(hex("1"));
    const second = result(hex("2"));
    expect(mergeProblemEvents([first], [second])).toEqual({
      events: [first, second],
      changed: true
    });
  });

  it("ignores duplicate relay delivery", () => {
    const event = result(hex("1"));
    expect(mergeProblemEvents([event], [event])).toEqual({
      events: [event],
      changed: false
    });
  });
});
