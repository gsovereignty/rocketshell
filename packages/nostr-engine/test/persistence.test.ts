import type { NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { attachEventCache, createNostrEngine, type EventCache } from "../src/index.js";

describe("browser event cache", () => {
  it("hydrates through central ingress and persists later store inserts", async () => {
    const cached = finalizeEvent({ kind: 1, created_at: 1, content: "cached", tags: [] }, generateSecretKey());
    const added: NostrEvent[] = [];
    const cache: EventCache = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), query: vi.fn(async () => [cached]), add: vi.fn(async (event) => { added.push(event); return true; }) };
    const engine = await attachEventCache(createNostrEngine(), cache);
    expect(engine.eventStore.getEvent(cached.id)?.content).toBe("cached");
    const live = finalizeEvent({ kind: 1, created_at: 2, content: "live", tags: [] }, generateSecretKey());
    engine.ingress.admit(live, "wss://relay.example"); await Promise.resolve();
    expect(added.some((event) => event.id === live.id)).toBe(true);
    await engine.close(); expect(cache.stop).toHaveBeenCalledOnce();
  });
});
