import type { ServiceHandler } from "@kehto/runtime";
import type { NappletMessage } from "@napplet/core";

export interface SubscriptionProtocol {
  readonly subscribe: string;
  readonly close: string;
  readonly closed: string;
}

export function limitServiceSubscriptions(handler: ServiceHandler, protocol: SubscriptionProtocol, maximum = 32): ServiceHandler {
  const active = new Map<string, Set<string>>();
  const forget = (windowId: string, subId: string): void => {
    const subscriptions = active.get(windowId); subscriptions?.delete(subId);
    if (subscriptions?.size === 0) active.delete(windowId);
  };
  return {
    descriptor: handler.descriptor,
    onRegistered: (context) => handler.onRegistered?.(context),
    onUnregistered() { active.clear(); handler.onUnregistered?.(); },
    handleMessage(windowId, message, send) {
      const envelope = message as NappletMessage & { subId?: unknown };
      const subId = typeof envelope.subId === "string" ? envelope.subId : "";
      let added = false;
      if (message.type === protocol.subscribe && subId) {
        const subscriptions = active.get(windowId) ?? new Set<string>();
        if (!subscriptions.has(subId) && subscriptions.size >= maximum) {
          send({ type: protocol.closed, subId, reason: "subscription-limit" } as NappletMessage);
          return;
        }
        if (!subscriptions.has(subId)) { subscriptions.add(subId); active.set(windowId, subscriptions); added = true; }
      } else if (message.type === protocol.close && subId) forget(windowId, subId);
      try {
        handler.handleMessage(windowId, message, (response) => {
          const result = response as NappletMessage & { subId?: unknown };
          if (response.type === protocol.closed && typeof result.subId === "string") forget(windowId, result.subId);
          send(response);
        });
      } catch (error) {
        if (added) forget(windowId, subId);
        throw error;
      }
    },
    onWindowDestroyed(windowId) { active.delete(windowId); handler.onWindowDestroyed?.(windowId); }
  };
}
