import { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { GroupReqMessage } from "applesauce-relay";
import { generateSecretKey, finalizeEvent, verifyEvent } from "nostr-tools/pure";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { EventIngress, openRelayStream } from "../src/index.js";

describe("full-message relay stream", () => {
  it("deduplicates delivery, merges relay observation, and emits aggregate EOSE once", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const ingress = new EventIngress(store, verifyEvent);
    const event = finalizeEvent({ kind: 1, created_at: 1, content: "x", tags: [] }, generateSecretKey());
    const delivered: NostrEvent[] = []; const eose = vi.fn();
    const handle = openRelayStream({ req: () => messages }, ingress, ["wss://one", "wss://two"], {}, { event: (value) => delivered.push(value), eose }, 10_000);
    messages.next({ type: "EVENT", from: "wss://one", id: "r", event }); messages.next({ type: "EVENT", from: "wss://two", id: "r", event });
    messages.next({ type: "EOSE", from: "wss://one", id: "r" }); messages.next({ type: "CLOSED", from: "wss://two", id: "r", reason: "done" }); messages.next({ type: "EOSE", from: "wss://two", id: "r" });
    expect(delivered).toHaveLength(1); expect(eose).toHaveBeenCalledOnce(); expect(eose).toHaveBeenCalledWith({ partial: false, pendingRelays: [] });
    handle.close(); store.dispose();
  });
  it("suppresses callbacks after close", () => {
    const messages = new Subject<GroupReqMessage>(); const store = new EventStore({ verifyEvent }); const delivered = vi.fn(); const eose = vi.fn();
    const handle = openRelayStream({ req: () => messages }, new EventIngress(store, verifyEvent), ["wss://one"], {}, { event: delivered, eose }, 5);
    handle.close(); messages.next({ type: "EOSE", from: "wss://one", id: "r" });
    expect(eose).not.toHaveBeenCalled(); expect(delivered).not.toHaveBeenCalled(); store.dispose();
  });
});
