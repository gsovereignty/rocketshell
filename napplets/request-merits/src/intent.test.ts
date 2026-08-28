import { describe, expect, it } from "vitest";
import { parseMeritRequestPayload } from "./intent";

describe("merit request intent", () => {
  it("accepts trimmed problem context", () => {
    expect(parseMeritRequestPayload({ problem: "  Sidebar cannot expand  " })).toEqual({ problem: "Sidebar cannot expand" });
  });

  it("rejects malformed payloads", () => {
    expect(parseMeritRequestPayload(undefined)).toBeUndefined();
    expect(parseMeritRequestPayload({ problem: " " })).toBeUndefined();
    expect(parseMeritRequestPayload({ problem: 42 })).toBeUndefined();
  });
});
