import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/nostrocket-state.json";
import { pendingMeritRequests } from "./pending";
import type { NostrEvent } from "./state";

const coordinate = `31108:${fixture.pubkey}:NOSTROCKET`;
const request = (overrides: Partial<NostrEvent> = {}): NostrEvent => ({ id: "7".repeat(64), pubkey: "8".repeat(64), created_at: 2, kind: 1409, tags: [["a", coordinate], ["problem", "text", "Build it"], ["merits", "42"]], content: "", sig: "9".repeat(128), ...overrides });

describe("pending merit requests", () => {
  it("keeps requests for the rocket that are absent from state", () => expect(pendingMeritRequests([request()], fixture as NostrEvent, coordinate)).toEqual([{ id: "7".repeat(64), requester: "8".repeat(64), merits: 42n, problem: "Build it", createdAt: 2 }]));
  it("removes requests already represented by merit lots", () => expect(pendingMeritRequests([request({ id: "9971eb6aaaf8bb36b07bb0815498c8b009b773f5f42d36c652fcea839afbe843" })], fixture as NostrEvent, coordinate)).toEqual([]));
  it("reports malformed amounts and skips other rockets", () => { const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined); expect(pendingMeritRequests([request({ tags: [["a", coordinate], ["merits", "-1"]] }), request({ id: "a".repeat(64), tags: [["a", "31108:" + "b".repeat(64) + ":OTHER"], ["merits", "3"]] })], fixture as NostrEvent, coordinate)).toEqual([]); expect(warn).toHaveBeenCalledOnce(); warn.mockRestore(); });
});
