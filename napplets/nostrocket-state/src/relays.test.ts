import { describe, expect, it } from "vitest";
import { selectNip66Relays } from "./relays";
import type { NostrEvent } from "./state";
const observation = (pubkey: string, url: string, rtt: string, extra: string[][] = []): NostrEvent => ({ id: "a".repeat(64), pubkey, created_at: 1, kind: 30166, tags: [["d", url], ["n", "clearnet"], ["rtt-read", rtt], ...extra], content: "", sig: "b".repeat(128) });
describe("NIP-66 relay selection", () => {
  it("prefers independent monitor count before RTT", () => { const selected = selectNip66Relays([observation("a", "wss://many.example", "90"), observation("b", "wss://many.example", "110"), observation("c", "wss://fast.example", "10")]); expect(selected.map(({ url }) => url)).toEqual(["wss://many.example/", "wss://fast.example/"]); expect(selected[0].monitors).toBe(2); });
  it("rejects non-clearnet, insecure, paid, and authenticated relays", () => { const events = [observation("a", "ws://plain.example", "1"), observation("b", "wss://paid.example", "2", [["R", "payment"]]), { ...observation("c", "wss://tor.example", "3"), tags: [["d", "wss://tor.example"], ["n", "tor"], ["rtt-read", "3"]] }]; expect(selectNip66Relays(events)).toEqual([]); });
});
