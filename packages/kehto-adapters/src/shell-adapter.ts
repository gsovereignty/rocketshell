import type { ShellAdapter } from "@kehto/shell";
import type { ServiceHandler } from "@kehto/runtime";
import type { AclCheckEvent } from "@kehto/runtime";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { accounts, eventStore, ingress, openRelayStream, publisher, relayPolicy, relayPool, telemetry, validateFilters } from "@platform/nostr-engine";
import { verifyEvent } from "nostr-tools/pure";
import { relayPoolLike } from "./relay-pool-like.js";
import { createRelayConfiguration, type PlatformRelayConfiguration } from "./relay-configuration.js";
import { extractFiltersFromWorkerRequest } from "./worker-relay.js";

export interface ShellAdapterOptions {
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
  readonly relayConfiguration?: PlatformRelayConfiguration;
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
  const subscriptions = new Map<string, () => void>();
  const scoped = new Map<string, { relay: string; close: () => void }>();
  let initialAccount = true; let closed = false;
  const closeAccountWork = (): void => {
    for (const cleanup of subscriptions.values()) cleanup();
    subscriptions.clear();
    for (const entry of scoped.values()) entry.close();
    scoped.clear();
  };
  const accountChanges = accounts.manager.active$.subscribe(() => {
    if (initialAccount) initialAccount = false;
    else closeAccountWork();
  });
  const relayConfiguration = options.relayConfiguration ?? createRelayConfiguration(relayPolicy, {
    discovery: [...options.discoveryRelays], super: [...options.readRelays], outbox: [...options.writeRelays]
  });
  return {
    services: Object.fromEntries((options.advertisedServices ?? []).map((name) => [name, advertisedService(name)])),
    relayPool: {
      getRelayPool: () => relayPoolLike,
      trackSubscription(key, cleanup) { subscriptions.get(key)?.(); subscriptions.set(key, cleanup); },
      untrackSubscription(key) { subscriptions.get(key)?.(); subscriptions.delete(key); },
      openScopedRelay(windowId, relayUrl, subId, filters, sourceWindow) {
        scoped.get(windowId)?.close();
        const relay = relayPolicy.normalize(relayUrl, "explicit");
        const handle = openRelayStream(relayPool, ingress, [relay], validateFilters(filters as Filter[]), {
          event: (event) => sourceWindow.postMessage(["EVENT", subId, event], "*"),
          eose: () => sourceWindow.postMessage(["EOSE", subId], "*")
        }, 15_000, telemetry);
        scoped.set(windowId, { relay, close: () => handle.close() });
      },
      closeScopedRelay(windowId) { scoped.get(windowId)?.close(); scoped.delete(windowId); },
      async publishToScopedRelay(windowId, event) {
        const entry = scoped.get(windowId); if (!entry) return false;
        try { await publisher.publishSigned([entry.relay], event as NostrEvent); return true; }
        catch { return false; }
      },
      selectRelayTier: () => [...relayConfiguration.values("super")]
    },
    relayConfig: {
      addRelay: (tier, url) => relayConfiguration.add(tier, url),
      removeRelay: (tier, url) => relayConfiguration.remove(tier, url),
      getRelayConfig: () => relayConfiguration.snapshot(),
      getNip66Suggestions: () => []
    },
    windowManager: { createWindow: options.createWindow },
    auth: {
      getUserPubkey: () => accounts.publicKey || null,
      getSigner: () => {
        const active = accounts.manager.active;
        if (!active) return null;
        return {
          getPublicKey: () => accounts.manager.signer.getPublicKey(),
          signEvent: (template: Parameters<typeof accounts.manager.signer.signEvent>[0]) => accounts.sign(template),
          ...(active.nip04 ? { nip04: {
            encrypt: (pubkey: string, plaintext: string) => accounts.nip04Encrypt(pubkey, plaintext),
            decrypt: (pubkey: string, ciphertext: string) => accounts.nip04Decrypt(pubkey, ciphertext)
          } } : {}),
          ...(active.nip44 ? { nip44: {
            encrypt: (pubkey: string, plaintext: string) => accounts.nip44Encrypt(pubkey, plaintext),
            decrypt: (pubkey: string, ciphertext: string) => accounts.nip44Decrypt(pubkey, ciphertext)
          } } : {})
        };
      }
    },
    config: { getNappUpdateBehavior: () => "banner" },
    hotkeys: { executeHotkeyFromForward: (event) => options.executeHotkey?.(event) },
    workerRelay: { getWorkerRelay: () => ({
      async event(event) { const admitted = ingress.admit(event as NostrEvent, "local:worker"); if (!admitted) throw new Error("invalid-event"); return admitted; },
      async query(request) { return eventStore.getByFilters(extractFiltersFromWorkerRequest(request)).map(plainEvent); },
      async count(request) { return eventStore.getByFilters(extractFiltersFromWorkerRequest(request)).length; }
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
