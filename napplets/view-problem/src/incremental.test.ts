import { describe, expect, it } from "vitest";
import type { RelayEventResult } from "@napplet/sdk";
import { ingestUniqueResults } from "./incremental";

const result = (id: string, kind = 31971) => ({ event: {
  id, kind, pubkey: "a".repeat(64), created_at: 1, content: "", tags: [], sig: "b".repeat(128)
} }) as RelayEventResult;

describe("incremental event ingestion", () => {
  it("makes each newly received event available immediately", () => {
    const store = new Map<string, RelayEventResult>();
    const first = result("1".repeat(64));
    const second = result("2".repeat(64), 1111);

    expect(ingestUniqueResults(store, [first])).toEqual([first]);
    expect([...store.values()]).toEqual([first]);
    expect(ingestUniqueResults(store, [second])).toEqual([second]);
    expect([...store.values()]).toEqual([first, second]);
  });

  it("deduplicates overlapping live and query deliveries", () => {
    const store = new Map<string, RelayEventResult>();
    const event = result("1".repeat(64));
    expect(ingestUniqueResults(store, [event, event])).toEqual([event]);
    expect(ingestUniqueResults(store, [event])).toEqual([]);
    expect(store.size).toBe(1);
  });
});
