import type { ShellAdapter } from "@kehto/shell";
import type { ServiceHandler } from "@kehto/runtime";
import type { AclCheckEvent } from "@kehto/runtime";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { NostrEngine } from "@platform/nostr-engine";
import { openRelayStream } from "@platform/nostr-engine";
import { verifyEvent } from "nostr-tools/pure";
import { createRelayPoolLike } from "./relay-pool-like.js";

export interface ShellAdapterOptions {
  readonly engine: NostrEngine;
  readonly discoveryRelays: readonly string[];
  readonly readRelays: readonly string[];
  readonly writeRelays: readonly string[];
  readonly createWindow: (options: { title: string; class: string; iframeSrc?: string }) => string | null;
  readonly executeHotkey?: (event: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
  readonly intentAvailable?: () => boolean;
  readonly linkAvailable?: () => boolean;
  readonly advertisedServices?: readonly string[];
  readonly onAclCheck?: (event: AclCheckEvent) => void;
  readonly onUnroutedMessage?: (info: { readonly type?: string; readonly origin: string; readonly reason: string }) => void;
}
export type PlatformShellAdapter = ShellAdapter & { close(): void };

function advertisedService(name: string): ServiceHandler {
  return {
    descriptor: { name, version: "1.0.0", description: `${name} host service` },
    handleMessage() {}
  };
}

function plainEvent(event: NostrEvent): NostrEvent {
  return { id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags.map((tag) => [...tag]), content: event.content, sig: event.sig };
}

export function createPlatformShellAdapter(options: ShellAdapterOptions): PlatformShellAdapter {
  const { engine } = options; const subscriptions = new Map<string, () => void>();
  const scoped = new Map<string, { relay: string; close: () => void }>();
  let initialAccount = true; let closed = false;
  const closeAccountWork = (): void => {
    for (const cleanup of subscriptions.values()) cleanup();
    subscriptions.clear();
    for (const entry of scoped.values()) entry.close();
    scoped.clear();
  };
  const accountChanges = engine.accounts.manager.active$.subscribe(() => {
    if (initialAccount) initialAccount = false;
    else closeAccountWork();
  });
  const discovery = engine.relayPolicy.select(options.discoveryRelays, "discovery");
  const read = engine.relayPolicy.select(options.readRelays, "read"); const write = engine.relayPolicy.select(options.writeRelays, "write");
  return {
    services: Object.fromEntries((options.advertisedServices ?? []).map((name) => [name, advertisedService(name)])),
    relayPool: {
      getRelayPool: () => createRelayPoolLike(engine.relayPool),
      trackSubscription(key, cleanup) { subscriptions.get(key)?.(); subscriptions.set(key, cleanup); },
      untrackSubscription(key) { subscriptions.get(key)?.(); subscriptions.delete(key); },
      openScopedRelay(windowId, relayUrl, subId, filters, sourceWindow) {
        scoped.get(windowId)?.close();
        const relay = engine.relayPolicy.normalize(relayUrl, "explicit");
        const handle = openRelayStream(engine.relayPool, engine.ingress, [relay], filters as Filter[], {
          event: (event) => sourceWindow.postMessage(["EVENT", subId, event], "*"),
          eose: () => sourceWindow.postMessage(["EOSE", subId], "*")
        }, 15_000, engine.telemetry);
        scoped.set(windowId, { relay, close: () => handle.close() });
      },
      closeScopedRelay(windowId) { scoped.get(windowId)?.close(); scoped.delete(windowId); },
      async publishToScopedRelay(windowId, event) {
        const entry = scoped.get(windowId); if (!entry) return false;
        const outcomes = await engine.relayPool.publish([entry.relay], event as NostrEvent, { retries: false });
        for (const outcome of outcomes) engine.telemetry.record("publication.outcome", outcome.ok ? 1 : 0, { relay: outcome.from });
        if (!outcomes.some((outcome) => outcome.ok)) engine.telemetry.record("publication.failed", 1, { relayCount: 1 });
        return outcomes.some((outcome) => outcome.ok);
      },
      selectRelayTier: () => [...read]
    },
    relayConfig: {
      addRelay() {}, removeRelay() {},
      getRelayConfig: () => ({ discovery: [...discovery], super: [...read], outbox: [...write] }),
      getNip66Suggestions: () => []
    },
    windowManager: { createWindow: options.createWindow },
    auth: {
      getUserPubkey: () => engine.accounts.publicKey || null,
      getSigner: () => engine.accounts.manager.active ? {
        getPublicKey: () => engine.accounts.manager.signer.getPublicKey(),
        signEvent: (template: Parameters<typeof engine.accounts.manager.signer.signEvent>[0]) => engine.accounts.sign(template)
      } : null
    },
    config: { getNappUpdateBehavior: () => "banner" },
    hotkeys: { executeHotkeyFromForward: (event) => options.executeHotkey?.(event) },
    workerRelay: { getWorkerRelay: () => ({
      async event(event) { const admitted = engine.ingress.admit(event as NostrEvent, "local:worker"); if (!admitted) throw new Error("invalid-event"); return admitted; },
      async query(filters) { return engine.eventStore.getByFilters(filters as Filter[]); },
      async count(filters) { return engine.eventStore.getByFilters(filters as Filter[]).length; }
    }) },
    crypto: { verifyEvent: async (event) => verifyEvent(plainEvent(event as NostrEvent)) },
    ...(options.intentAvailable ? { intent: { isAvailable: options.intentAvailable } } : {}),
    ...(options.linkAvailable ? { link: { isAvailable: options.linkAvailable } } : {}),
    ...(options.onAclCheck ? { onAclCheck: options.onAclCheck } : {}),
    onUnroutedMessage: (info) => options.onUnroutedMessage?.(info),
    capabilities: {
      resolveEnvironment(_identity, available) {
        const domains = available.domains.filter((domain) => {
          if (domain === "intent" && !options.intentAvailable?.()) return false;
          if (domain === "link" && !options.linkAvailable?.()) return false;
          return true;
        });
        return { domains, services: available.services.filter((service) => domains.includes(service)) };
      }
    },
    close() {
      if (closed) return;
      closed = true; accountChanges.unsubscribe(); closeAccountWork();
    }
  };
}
