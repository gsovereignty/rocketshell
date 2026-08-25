import type { NostrEvent } from "applesauce-core/helpers/event";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_EVENT_DATABASE_NAME, type EventCache } from "../src/index.js";
import { freshServices } from "./fresh.js";

describe("browser event cache", () => {
  it("uses a database namespace separate from verified packages", () => {
    expect(PUBLIC_EVENT_DATABASE_NAME).toBe("platform-events");
    expect(PUBLIC_EVENT_DATABASE_NAME).not.toBe("napplet-packages");
  });
  it("hydrates through central ingress and persists later store inserts", async () => {
    const cached = finalizeEvent({ kind: 1, created_at: 1, content: "cached", tags: [] }, generateSecretKey());
    const added: NostrEvent[] = [];
    const cache: EventCache = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), query: vi.fn(async () => [cached]), add: vi.fn(async (event) => { added.push(event); return true; }) };
    const { attachEventCache, eventStore, ingress, shutdownNostrServices } = await freshServices();
    const detach = await attachEventCache(cache);
    expect(eventStore.getEvent(cached.id)?.content).toBe("cached");
    const live = finalizeEvent({ kind: 1, created_at: 2, content: "live", tags: [] }, generateSecretKey());
    ingress.admit(live, "wss://relay.example"); await Promise.resolve();
    expect(added.some((event) => event.id === live.id)).toBe(true);
    await detach(); shutdownNostrServices(); expect(cache.stop).toHaveBeenCalledOnce();
  });

  it("persists a newer replaceable relay event and hydrates it after restart", async () => {
    const secret = generateSecretKey();
    const cached = finalizeEvent({ kind: 0, created_at: 1, content: JSON.stringify({ name: "old" }), tags: [] }, secret);
    const current = finalizeEvent({ kind: 0, created_at: 2, content: JSON.stringify({ name: "new" }), tags: [] }, secret);
    const records = new Map([[cached.id, cached]]);
    const cache: EventCache = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      query: vi.fn(async () => [...records.values()]),
      add: vi.fn(async (event) => {
        for (const [id, stored] of records) {
          if (stored.kind === event.kind && stored.pubkey === event.pubkey && stored.kind === 0) records.delete(id);
        }
        records.set(event.id, event);
        return true;
      })
    };

    const first = await freshServices();
    const detachFirst = await first.attachEventCache(cache);
    expect(first.eventStore.getReplaceable(0, cached.pubkey)?.id).toBe(cached.id);
    first.ingress.admit(current, "wss://relay.example");
    expect(first.eventStore.getReplaceable(0, cached.pubkey)?.id).toBe(current.id);
    await detachFirst();
    first.shutdownNostrServices();
    expect(cache.add).toHaveBeenCalledWith(expect.objectContaining({ id: current.id }));

    const second = await freshServices();
    const detachSecond = await second.attachEventCache(cache);
    expect(second.eventStore.getReplaceable(0, cached.pubkey)?.id).toBe(current.id);
    second.ingress.admit(cached, "cache:late-old-record");
    expect(second.eventStore.getReplaceable(0, cached.pubkey)?.id).toBe(current.id);
    await detachSecond();
    second.shutdownNostrServices();
  });
});
