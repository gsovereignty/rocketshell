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
});
