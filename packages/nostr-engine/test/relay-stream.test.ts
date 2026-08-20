import { EventStore } from "applesauce-core/event-store";
import { getSeenRelays } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { GroupReqMessage } from "applesauce-relay";
import { generateSecretKey, finalizeEvent, verifyEvent } from "nostr-tools/pure";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createEventIngress, openRelayStream } from "../src/index.js";

describe("full-message relay stream", () => {
  it("deduplicates delivery, merges relay observation, and emits aggregate EOSE once", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const ingress = createEventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "x", tags: [] }, generateSecretKey());
    const delivered: NostrEvent[] = []; const eose = vi.fn();
    const handle = openRelayStream({ req: () => messages }, ingress, ["wss://one", "wss://two"], {}, { event: (value) => delivered.push(value), eose }, 10_000);
    messages.next({ type: "EVENT", from: "wss://one", id: "r", event }); messages.next({ type: "EVENT", from: "wss://two", id: "r", event });
    messages.next({ type: "EOSE", from: "wss://one", id: "r" }); messages.next({ type: "CLOSED", from: "wss://two", id: "r", reason: "done" }); messages.next({ type: "EOSE", from: "wss://two", id: "r" });
    expect(delivered).toHaveLength(1); expect(eose).toHaveBeenCalledOnce(); expect(eose).toHaveBeenCalledOnce();
    expect([...getSeenRelays(store.getEvent(event.id)!)!].sort()).toEqual(["wss://one", "wss://two"]);
    handle.close(); store.dispose();
  });
  it("suppresses callbacks after close", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const delivered = vi.fn(); const eose = vi.fn();
    const handle = openRelayStream({ req: () => messages }, createEventIngress(store, verifyEvent), ["wss://one"], {}, { event: delivered, eose }, 5);
    handle.close(); messages.next({ type: "EOSE", from: "wss://one", id: "r" });
    expect(eose).not.toHaveBeenCalled(); expect(delivered).not.toHaveBeenCalled(); store.dispose();
  });
  it("completes an empty relay selection without opening a request", () => {
    const store = new EventStore({ verifyEvent }); const req = vi.fn(() => new Subject<GroupReqMessage>()); const eose = vi.fn();
    const handle = openRelayStream({ req }, createEventIngress(store, verifyEvent), [], {}, { event: vi.fn(), eose });
    expect(req).not.toHaveBeenCalled(); expect(eose).toHaveBeenCalledOnce(); expect(eose).toHaveBeenCalledOnce();
    handle.close(); expect(handle.closed).toBe(true); store.dispose();
  });
  it("ends the barrier on timeout and keeps delivering live events", async () => {
    vi.useFakeTimers();
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const delivered = vi.fn(); const eose = vi.fn();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "late", tags: [] }, generateSecretKey());
    const handle = openRelayStream({ req: () => messages }, createEventIngress(store, verifyEvent), ["wss://one", "wss://two"], {}, { event: delivered, eose }, 50);
    messages.next({ type: "EOSE", from: "wss://one", id: "r" });
    await vi.advanceTimersByTimeAsync(50);
    expect(eose).toHaveBeenCalledOnce();
    messages.next({ type: "EVENT", from: "wss://two", id: "r", event });
    messages.next({ type: "EOSE", from: "wss://two", id: "r" });
    expect(delivered).toHaveBeenCalledOnce(); expect(eose).toHaveBeenCalledOnce();
    handle.close(); store.dispose(); vi.useRealTimers();
  });
  it("rejects invalid events and converts ERROR and CLOSED into relay barriers", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const delivered = vi.fn(); const eose = vi.fn(); const error = vi.fn();
    const invalid = { ...finalizeEvent({ kind: 1, created_at: 1, content: "x", tags: [] }, generateSecretKey()), sig: "00".repeat(64) };
    const handle = openRelayStream({ req: () => messages }, createEventIngress(store, verifyEvent), ["wss://one", "wss://two"], {}, { event: delivered, eose, error }, 10_000);
    messages.next({ type: "EVENT", from: "wss://one", id: "r", event: invalid });
    messages.next({ type: "ERROR", from: "wss://one", error: new Error("offline") });
    messages.next({ type: "CLOSED", from: "wss://two", id: "r", reason: "blocked" });
    expect(delivered).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledOnce();
    expect(eose).toHaveBeenCalledOnce();
    handle.close(); store.dispose();
  });
  it("maps observable failure to every pending relay and emits one EOSE", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const error = vi.fn(); const eose = vi.fn();
    const handle = openRelayStream({ req: () => messages }, createEventIngress(store, verifyEvent), ["wss://one", "wss://two"], {}, { event: vi.fn(), eose, error }, 10_000);
    messages.next({ type: "EOSE", from: "wss://one", id: "r" }); messages.error(new Error("connection lost"));
    expect(error).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledWith("wss://two", expect.any(Error)); expect(eose).toHaveBeenCalledOnce();
    handle.close(); store.dispose();
  });
  it("keeps aggregate EOSE singular across reconnect messages", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const delivered = vi.fn(); const eose = vi.fn();
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "after reconnect", tags: [] }, generateSecretKey());
    const handle = openRelayStream({ req: () => messages }, createEventIngress(store, verifyEvent), ["wss://one"], {}, { event: delivered, eose }, 10_000);
    messages.next({ type: "EOSE", from: "wss://one", id: "first" });
    messages.next({ type: "OPEN", from: "wss://one", id: "second", filters: [{}] });
    messages.next({ type: "EVENT", from: "wss://one", id: "second", event });
    messages.next({ type: "EOSE", from: "wss://one", id: "second" });
    expect(eose).toHaveBeenCalledOnce(); expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }));
    handle.close(); store.dispose();
  });
  it("ignores malformed protocol messages", () => {
    const messages = new Subject<unknown>(); const store = new EventStore({ verifyEvent }); const delivered = vi.fn(); const eose = vi.fn(); const error = vi.fn();
    const handle = openRelayStream({ req: () => messages } as never, createEventIngress(store, verifyEvent), ["wss://one"], {}, { event: delivered, eose, error }, 10_000);
    messages.next(null); messages.next({}); messages.next({ type: "EVENT", from: 42, event: {} }); messages.next({ type: "EOSE", from: null });
    expect(delivered).not.toHaveBeenCalled(); expect(eose).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    handle.close(); store.dispose();
  });
});
