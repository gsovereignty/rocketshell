import { describe, expect, it } from "vitest";
import fixture from "./fixtures/nostrocket-state.json";
import { aggregateMeritHoldings, parseMeritTag, validateStateEvent, type NostrEvent } from "./state";

const event = fixture as NostrEvent;
describe("NOSTROCKET state", () => {
  it("keeps complete fetched reference event", () => { expect(event.id).toBe("2aff6b8c5e9560dbe6cab403c0a3eea478ddfe06f1361dfb05fa582a0dddb207"); expect(() => validateStateEvent(event)).not.toThrow(); });
  it("parses defined merit tuple", () => { expect(parseMeritTag(["merit", "f320f167c3d338b8517e1426b5db43ea51d84143842a2ca9e0ebc029f5e07b95:9971eb6aaaf8bb36b07bb0815498c8b009b773f5f42d36c652fcea839afbe843:0:0:57000"]).merits).toBe(57000n); });
  it("aggregates reference holdings", () => { const holdings = aggregateMeritHoldings(event); expect(holdings).toHaveLength(6); expect(holdings[0]).toMatchObject({ owner: "f320f167c3d338b8517e1426b5db43ea51d84143842a2ca9e0ebc029f5e07b95", merits: 2581248n }); expect(holdings.reduce((sum, item) => sum + item.merits, 0n)).toBe(4492175n); });
  it("rejects ambiguous and duplicate lots", () => { expect(() => parseMeritTag(["merit", "bad"])).toThrow(); const duplicate = { ...event, tags: [...event.tags, event.tags.find(([name]) => name === "merit")!] }; expect(() => aggregateMeritHoldings(duplicate)).toThrow(/Duplicate/); });
  it("validates another rocket against its full coordinate", () => { const other = { ...event, pubkey: "a".repeat(64), tags: event.tags.map((tag) => tag[0] === "d" ? ["d", "SATURN"] : tag) }; expect(() => validateStateEvent(other, `31108:${other.pubkey}:SATURN`)).not.toThrow(); expect(() => validateStateEvent(other, `31108:${other.pubkey}:MARS`)).toThrow(/identifier/); });
  it("preserves colons inside the d identifier", () => { const other = { ...event, pubkey: "a".repeat(64), tags: event.tags.map((tag) => tag[0] === "d" ? ["d", "SATURN:OPS"] : tag) }; expect(() => validateStateEvent(other, `31108:${other.pubkey}:SATURN:OPS`)).not.toThrow(); });
});
