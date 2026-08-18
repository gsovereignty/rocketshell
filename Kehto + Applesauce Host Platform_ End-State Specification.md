# Kehto + Applesauce Host Platform: End-State Specification

**Status:** Proposed end-state architecture  
**Baseline verified:** August 18, 2026  
**Scope:** Generic Nostr runtime, relay, identity, storage, communication, and Napplet-hosting platform  
**Excluded:** Application-specific event kinds, domain models, reducers, workflows, and user-interface behavior

This document uses **Kehto** as the name of the runtime from `kehto/web`.

---

## 1. Purpose

This specification defines how to combine:

- **Kehto** as the security boundary, Napplet runtime, capability broker, lifecycle manager, and browser shell.
- **Applesauce** as the host-internal Nostr implementation: relay connections, subscriptions, event storage, account management, signing adapters, loading, and reactive state.
- **NAP domains** as the only API exposed to sandboxed Napplets.

The resulting platform must let a Napplet perform Nostr operations without receiving:

- private keys;
- signer objects;
- Applesauce objects;
- relay connection objects;
- raw WebSocket access;
- direct browser persistence;
- unrestricted network access;
- host database handles;
- another Napplet’s state.

The central architectural rule is:

> **Applesauce implements Nostr inside the host. Kehto governs access to it. Napplets see only typed NAP capabilities.**

---

## 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

- **MUST** means required for platform conformance.
- **SHOULD** means strongly recommended unless a documented constraint justifies a different implementation.
- **MAY** means optional.
- **Host** means the trusted browser application embedding Kehto.
- **Napplet** means an untrusted application artifact hosted by Kehto.
- **Platform profile** means the specific set of NAP domains guaranteed by this implementation.
- **Nostr engine** means the host-owned Applesauce services and their adapters.

---

## 3. Executive architecture

```text
┌───────────────────────────────────────────────────────────┐
│                    Sandboxed Napplet                      │
│                                                           │
│  window.napplet.shell                                     │
│  window.napplet.identity                                  │
│  window.napplet.outbox                                    │
│  window.napplet.relay                                     │
│  window.napplet.storage                                   │
│  window.napplet.resource                                  │
│  window.napplet.config                                    │
│  window.napplet.theme                                     │
│  window.napplet.intent                                    │
│  window.napplet.inc                                       │
│  window.napplet.link                                      │
└───────────────────────┬───────────────────────────────────┘
                        │ NIP-5D messages over postMessage
                        ▼
┌───────────────────────────────────────────────────────────┐
│                  Kehto Shell + Runtime                    │
│                                                           │
│  iframe/session identity        ACL and consent           │
│  message validation             capability discovery      │
│  signing mediation              storage isolation         │
│  subscription lifecycle         intent resolution         │
│  service dispatch               event replay protection   │
└───────────────────────┬───────────────────────────────────┘
                        │ Host-side adapters
                        ▼
┌───────────────────────────────────────────────────────────┐
│                  Applesauce Nostr Engine                  │
│                                                           │
│  RelayPool                 EventStore                     │
│  AccountManager            active ISigner                 │
│  event/load helpers        relay-list resolver            │
│  relay status streams      persistent event database      │
└───────────────────────┬───────────────────────────────────┘
                        │ Nostr protocol
                        ▼
┌───────────────────────────────────────────────────────────┐
│                      Nostr relays                         │
└───────────────────────────────────────────────────────────┘
```

Kehto owns browser integration, source-window authentication, capability enforcement, runtime dispatch, storage, and session lifecycle. Its reference services are adapters around host-provided relay, signer, fetch, media, and persistence implementations.

Applesauce remains completely below this boundary. A Napplet must never know that Applesauce is the implementation behind its NAP calls.

---

## 4. Non-negotiable invariants

### 4.1 Sandbox invariant

Every Napplet MUST run in an opaque-origin iframe with:

```html
<iframe sandbox="allow-scripts">
```

The host MUST NOT add `allow-same-origin`. Napplet identity must be assigned by the host from the verified manifest identity, not claimed by the iframe. Kehto’s required loading order is: resolve and verify the manifest, derive `(dTag, aggregateHash)`, register the session identity, and only then navigate the iframe.

### 4.2 Key isolation invariant

A Napplet MUST NOT receive:

- an `ISigner`;
- a Kehto `Signer`;
- a private key;
- `window.nostr`;
- NIP-04 or NIP-44 raw decrypt methods;
- an account object;
- a signing callback.

Napplet-visible identity is strictly read-only. Event signing and encryption happen inside Kehto or a host service after ACL and consent checks. Kehto explicitly requires that `window.nostr` not be exposed, and its identity service deliberately removes Napplet-visible signing and encryption operations.

### 4.3 Network isolation invariant

A Napplet MUST NOT establish relay WebSockets directly.

The gateway SHOULD enforce:

```text
connect-src 'none'
```

in its Content Security Policy. External byte retrieval must go through `window.napplet.resource`. User-visible external navigation must go through `window.napplet.link`.

### 4.4 Applesauce isolation invariant

The following MUST remain host-private:

```text
RelayPool
Relay
RelayGroup
EventStore
AccountManager
ISigner
RxJS Observable instances
persistent event database
relay policy
relay health information
relay-list cache
decrypted private data
```

Only structured-clone-safe NAP request and result values may cross into a Napplet.

### 4.5 Signed-template invariant

A Napplet publishes an **unsigned event template**:

```ts
{
  kind,
  content,
  tags,
  created_at
}
```

Kehto obtains the active signer, performs authorization and consent checks, signs the template, and publishes the signed event. `relay.publish` must not report success before the transport settles.

### 4.6 Verification invariant

Every event received from a relay MUST be cryptographically verified before:

- delivery to a Napplet;
- admission into persistent storage;
- use in identity or relay-routing decisions;
- use by a host-side projection;
- use as a replaceable-event winner.

The same verification implementation SHOULD be supplied to both Kehto and Applesauce.

### 4.7 Single-engine invariant

One shell profile MUST use:

- one shared Applesauce `RelayPool`;
- one shared public-event `EventStore`;
- one shared account controller;
- one relay policy;
- one relay-list resolver.

Creating a separate relay pool or event database per Napplet is prohibited.

### 4.8 Lifecycle invariant

Destroying a Napplet window MUST cancel all subscriptions, pending requests, object URLs, intent waits, INC listeners, and other resources owned by that window.

Destroying the host MUST:

1. remove the `message` listener;
2. destroy the Kehto bridge;
3. unsubscribe host observables;
4. close the Applesauce relay pool;
5. dispose the Applesauce event store;
6. stop timers and persistence workers.

Kehto’s bridge destroy operation clears its own subscriptions, buffers, and registries, but host-owned pools and timers remain the host’s responsibility.

---

## 5. Dependency and compatibility baseline

The platform MUST use an exact lockfile and SHOULD pin either exact package versions or a tested repository commit. Kehto remains alpha and its NAP names, envelopes, and helper APIs can change.

The verified baseline is:

| Package | Baseline |
|---|---:|
| `@kehto/runtime` | `0.22.0` |
| `@kehto/shell` | `0.20.0` |
| `@kehto/services` | `0.20.0` |
| `@napplet/core` | `0.31.x` |
| `@napplet/nap` | `0.31.x` |
| `applesauce-core` | `6.2.0` |
| `applesauce-relay` | `6.2.1` |
| `applesauce-loaders` | `6.2.0` |
| `applesauce-accounts` | `6.2.0` |
| `applesauce-signers` | `6.2.2` |
| `nostr-tools` | compatible `2.24.x` line |
| `rxjs` | compatible `7.8.x` line |

Kehto’s current shell and service packages declare the `@napplet/core` and `@napplet/nap` `0.31` line as peers. Applesauce’s current package manifests identify the versions above and its relay package depends on the `nostr-tools` 2.24 line.

The repository MUST maintain a compatibility record such as:

```ts
export const PLATFORM_COMPATIBILITY = {
  profile: "platform-nap-v1",
  kehto: {
    runtime: "0.22.0",
    shell: "0.20.0",
    services: "0.20.0",
  },
  napplet: {
    core: "0.31.x",
    nap: "0.31.x",
  },
  applesauce: {
    core: "6.2.0",
    relay: "6.2.1",
    loaders: "6.2.0",
    accounts: "6.2.0",
    signers: "6.2.2",
  },
} as const;
```

An upstream dependency upgrade MUST pass all conformance and end-to-end tests before the lockfile is changed.

---

## 6. Component responsibilities

### 6.1 Kehto shell

The Kehto shell MUST own:

- iframe creation;
- manifest-to-window identity registration;
- `postMessage` listening and source validation;
- capability advertisement;
- optional-domain injection;
- external window creation;
- intent/window lifecycle;
- browser-specific host hooks;
- identity and theme change propagation.

### 6.2 Kehto runtime

The Kehto runtime MUST own:

- message dispatch;
- ACL enforcement;
- consent flow;
- replay protection;
- service lookup;
- per-window subscription cleanup;
- scoped Napplet storage;
- INC sender attestation;
- unsigned-template signing flow;
- runtime lifecycle.

### 6.3 Applesauce RelayPool

The shared Applesauce `RelayPool` MUST own:

- normalized relay instances;
- WebSocket connection reuse;
- relay status streams;
- relay authentication transport;
- reconnect behavior;
- subscription fanout;
- publication fanout;
- relay protocol message handling.

Applesauce’s pool normalizes relay URLs and caches one relay object per normalized URL. It exposes `req()` for full per-relay protocol messages, `request()` for a bounded event-only stream, `subscription()` for a live event-only stream, and `publish()` for per-relay publication responses.

### 6.4 Applesauce EventStore

The shared public-event `EventStore` MUST own:

- signature verification on insertion;
- event-ID deduplication;
- replaceable-event winner selection;
- deletion handling;
- expiration handling;
- relay provenance;
- reactive store notifications;
- persistent event lookup.

Applesauce’s `EventStore.add(event, fromRelay?)` records relay provenance, verifies the event, handles replaceable winners, and returns either the admitted/stored event or `null` when rejected.

### 6.5 Account controller

The account controller MUST own:

- available host accounts;
- active account;
- active public key;
- active signer;
- account switching;
- signer-specific setup;
- signer request queues;
- account persistence;
- identity-change propagation.

Applesauce’s `AccountManager` exposes active-account state and a proxy signer for the current account. The proxy signer must remain host-side.

### 6.6 Relay policy

The relay policy MUST own:

- relay URL normalization;
- scheme validation;
- allow and deny rules;
- default discovery relays;
- default read relays;
- default write relays;
- maximum relays per operation;
- explicit-hint handling;
- relay-list routing;
- health-based selection;
- publication success thresholds;
- retry policy.

A Napplet may supply a relay hint only where the NAP permits it. The relay policy remains authoritative.

### 6.7 Relay-list resolver

The relay-list resolver MUST:

- resolve author read/write relay lists;
- query fixed discovery relays without depending recursively on the outbox router;
- cache the newest valid replaceable relay-list event;
- parse and normalize relay URLs;
- reject disallowed URLs;
- distinguish absent lists from empty lists;
- support bounded negative caching.

### 6.8 Napplet gateway

The gateway MUST:

- resolve the signed manifest;
- verify the manifest signature;
- verify every artifact hash;
- verify the aggregate hash;
- serve only verified bytes;
- add the sandbox and CSP;
- inject the `window.napplet` prelude before authored scripts;
- register the `(dTag, aggregateHash)` identity before navigation.

---

## 7. Recommended source layout

```text
src/
├── platform/
│   ├── versions.ts
│   ├── lifecycle.ts
│   ├── errors.ts
│   └── observability.ts
│
├── nostr/
│   ├── engine.ts
│   ├── event-store.ts
│   ├── event-database.ts
│   ├── accounts.ts
│   ├── signer-adapter.ts
│   ├── relay-policy.ts
│   ├── relay-lists.ts
│   ├── relay-stream.ts
│   ├── relay-publish.ts
│   └── loaders.ts
│
├── kehto/
│   ├── shell-adapter.ts
│   ├── relay-pool-like.ts
│   ├── worker-relay.ts
│   ├── relay-service.ts
│   ├── outbox-service.ts
│   ├── identity-service.ts
│   ├── resource-service.ts
│   ├── intent-service.ts
│   ├── link-service.ts
│   ├── service-registration.ts
│   └── capability-profile.ts
│
├── napplets/
│   ├── gateway.ts
│   ├── manifest-resolver.ts
│   ├── artifact-cache.ts
│   ├── session-registry.ts
│   └── window-manager.ts
│
└── contract/
    ├── platform-nap-v1.ts
    ├── assertions.ts
    └── conformance.ts
```

Application-specific code MUST live outside this layer.

---

## 8. Startup sequence

The host MUST start in this order:

```text
1. Open the host persistence layer.
2. Create the persistent EventStore database adapter.
3. Create EventStore with verification enabled.
4. Create the shared RelayPool.
5. Restore accounts and select the active account.
6. Create relay policy.
7. Create relay-list resolver.
8. Create signer and relay adapters.
9. Create the Kehto ShellAdapter.
10. Create the Kehto shell bridge.
11. Register all required services.
12. Attach bridge.handleMessage to window.message.
13. Mark the platform ready.
14. Resolve and verify a Napplet manifest.
15. Register the Napplet session identity.
16. Create and navigate the sandboxed iframe.
17. Publish current identity and theme state.
```

Reference services MUST be registered before a Napplet iframe is loaded.

---

## 9. Applesauce engine construction

A representative host-owned engine is:

```ts
import { EventStore } from "applesauce-core/event-store";
import { RelayPool } from "applesauce-relay";
import { AccountManager } from "applesauce-accounts";
import { verifyEvent } from "nostr-tools/pure";

export interface NostrEngine {
  relayPool: RelayPool;
  eventStore: EventStore;
  accounts: AccountManager;
  close(): void;
}

export function createNostrEngine(
  database: ConstructorParameters<typeof EventStore>[0] extends
    { database?: infer T }
      ? T
      : never,
): NostrEngine {
  const eventStore = new EventStore({
    database,
    verifyEvent,
    keepDeleted: false,
    keepExpired: false,
    keepOldVersions: false,
  });

  const relayPool = new RelayPool({
    // Configure relay authentication and reconnect policy here.
  });

  const accounts = new AccountManager();

  return {
    relayPool,
    eventStore,
    accounts,

    close() {
      relayPool.close();
      eventStore.dispose();
    },
  };
}
```

The exact database type should be imported directly from the installed Applesauce version rather than inferred as above; the inference only illustrates the relationship.

### 9.1 EventStore policy

The public event store MUST:

- verify signatures;
- discard expired events unless a specific archival mode is enabled;
- discard losing replaceable versions by default;
- apply valid deletion events;
- record every observed relay;
- use a persistent host database;
- never store decrypted content as a mutation of the public signed event.

The host MUST NOT set:

```ts
verifyEvent: undefined
```

because Applesauce explicitly treats that as disabling signature checks.

### 9.2 Public and private storage separation

Use:

```text
public-event database
    signed Nostr events
    relay provenance
    replaceable/deletion state

account-private database
    decrypted payloads
    signer metadata
    account settings
    private indices
    secret material references

Napplet state
    Kehto NAP-STORAGE only
```

Private or decrypted material MUST NOT be attached to shared event objects in a way that another account or Napplet could observe.

### 9.3 Central ingress function

All relay adapters SHOULD use one ingress function:

```ts
import type { NostrEvent } from "nostr-tools";

export interface EventIngress {
  admit(event: NostrEvent, relayUrl?: string): NostrEvent | null;
}

export function createEventIngress(
  eventStore: EventStore,
): EventIngress {
  return {
    admit(event, relayUrl) {
      return eventStore.add(event, relayUrl);
    },
  };
}
```

The returned event may be:

- the newly inserted object;
- an existing event with the same ID;
- the winning replaceable event;
- `null` when rejected.

Adapters MUST use the returned value rather than assuming the input object was admitted.

---

## 10. Account and signer wiring

Applesauce’s signer contract is structurally close to Kehto’s signer contract. Applesauce requires `getPublicKey()` and `signEvent(template)`, with optional NIP-04 and NIP-44 methods; Kehto accepts the same core operations and optionally adds `getRelays()`.

### 10.1 Signer adapter

```ts
import type { ISigner } from "applesauce-signers";
import type { Signer as KehtoSigner } from "@kehto/runtime";

export interface ActiveAccountSource {
  getActiveSigner(): ISigner | null;
  getConfiguredRelays(): Record<
    string,
    { read: boolean; write: boolean }
  >;
}

export function createKehtoSignerAdapter(
  source: ActiveAccountSource,
): KehtoSigner | null {
  const signer = source.getActiveSigner();
  if (!signer) return null;

  return {
    getPublicKey: () => signer.getPublicKey(),

    signEvent: (template) =>
      signer.signEvent(template),

    getRelays: () =>
      source.getConfiguredRelays(),

    nip04: signer.nip04
      ? {
          encrypt: (pubkey, plaintext) =>
            signer.nip04!.encrypt(pubkey, plaintext),
          decrypt: (pubkey, ciphertext) =>
            signer.nip04!.decrypt(pubkey, ciphertext),
        }
      : undefined,

    nip44: signer.nip44
      ? {
          encrypt: (pubkey, plaintext) =>
            signer.nip44!.encrypt(pubkey, plaintext),
          decrypt: (pubkey, ciphertext) =>
            signer.nip44!.decrypt(pubkey, ciphertext),
        }
      : undefined,
  };
}
```

This adapter MUST be called dynamically. It must not capture a signer permanently because the active account may change.

### 10.2 Signer authorization

Kehto’s ACL and consent checks are the primary Napplet authorization boundary. The account implementation MAY add another policy layer, for example:

- signer confirmation;
- hardware-device confirmation;
- remote-signer approval;
- event-kind restrictions;
- rate limits.

A rejection from any layer MUST be reported as a failed NAP operation. It must never be converted to success.

### 10.3 Account switching

On active-account change, the host MUST:

1. invalidate the previous signer adapter;
2. notify Kehto through `publishIdentityChanged`;
3. close all account-sensitive live subscriptions;
4. clear pending signing requests;
5. clear or re-partition decrypted state;
6. require Napplets to reacquire identity state;
7. reauthenticate relay connections where necessary.

The public event store MAY remain available across accounts, provided it contains only public signed events and non-sensitive provenance.

---

## 11. Relay policy

A single policy object MUST mediate every relay URL.

```ts
export interface RelayPolicyContext {
  operation:
    | "discovery"
    | "read"
    | "write"
    | "explicit-read"
    | "explicit-write"
    | "auth";
  napplet?: {
    pubkey: string;
    dTag: string;
    hash: string;
  };
}

export interface RelayPolicy {
  normalizeAndAllow(
    url: string,
    context: RelayPolicyContext,
  ): string | null;

  getDiscoveryRelays(): string[];
  getFallbackReadRelays(): string[];
  getDefaultWriteRelays(): string[];

  selectDirectReadRelays(filters: unknown[]): string[];
  selectDirectPublishRelays(event: unknown): string[];

  maxRelaysPerRequest: number;
}
```

### 11.1 URL rules

The policy MUST:

- accept only `wss:` by default;
- MAY permit `ws:` for localhost development;
- reject embedded credentials;
- reject fragments;
- normalize trailing slash and casing consistently;
- deduplicate normalized URLs;
- enforce per-operation maximums;
- reject malformed URLs;
- apply host allow and deny lists;
- apply the same gate to caller-provided hints and discovered relay lists.

### 11.2 Relay tiers

The host SHOULD maintain:

```ts
interface RelayConfiguration {
  discovery: string[];
  super: string[];
  outbox: string[];
}
```

These names align with the current Kehto relay configuration hook.

A recommended interpretation is:

- **discovery:** relay-list and account metadata discovery;
- **super:** broad fallback reads;
- **outbox:** default user write destinations.

### 11.3 Request limits

At minimum, the policy SHOULD enforce:

```text
maximum relays per Napplet request:       10
maximum filters per request:               8
maximum ids per filter:                 1000
maximum authors per filter:             1000
maximum tag values per filter:          1000
default bounded query timeout:          4000 ms
direct-relay EOSE fallback:            15000 ms
maximum event content size: host policy
maximum concurrent subscriptions: host policy per Napplet
```

Limits should be configurable, observable, and enforced before opening relay work.

---

## 12. Relay-list resolver

The outbox router needs:

```ts
loadRelayLists(
  pubkeys: string[],
): Promise<Map<string, {
  read: string[];
  write: string[];
}>>;
```

That contract matches Kehto’s `RelayPoolOutboxRouterOptions`.

### 12.1 Resolution algorithm

For each requested public key:

1. Check the EventStore for the newest valid relay-list event.
2. Accept the cached value when it is inside the host freshness policy.
3. Collect missing or stale public keys.
4. Query fixed discovery relays directly through Applesauce.
5. Admit valid results into the EventStore.
6. Select the newest replaceable winner.
7. Parse read/write tags.
8. Normalize and policy-gate every URL.
9. Return a `Map`.
10. Record genuinely missing keys separately in internal telemetry.

The resolver MUST NOT call the outbox router to discover outbox relay lists. That would create recursive routing.

### 12.2 Cache semantics

Recommended defaults:

```text
positive cache freshness:   15 minutes
negative cache freshness:    1 minute
stale usable period:        24 hours
```

A stale cached relay list MAY be used as a fallback while a refresh is in progress, but the host should mark the internal result as stale.

---

## 13. Applesauce full-message subscription adapter

### 13.1 Why `req()` is mandatory here

Applesauce’s:

```ts
pool.subscription(...)
```

emits only deduplicated events. It filters out `EOSE`, relay errors, relay closure messages, and source-relay metadata.

Kehto’s relay adapter requires:

- event delivery;
- EOSE delivery;
- observed relay URLs;
- deterministic subscription closure.

Therefore, the Kehto-facing adapter MUST use:

```ts
pool.req(...)
```

and interpret the full `GroupReqMessage` stream. Applesauce’s source shows that `request()` and `subscription()` internally filter the stream to `EVENT` messages, while `req()` preserves full per-relay protocol messages.

### 13.2 Shared adapter

```ts
import type { NostrEvent, NostrFilter } from "@napplet/core";
import type { RelayPool } from "applesauce-relay";

interface RelayItemCallback {
  (
    item: NostrEvent | "EOSE",
    observedRelayUrls?: string[],
  ): void;
}

export function subscribeWithFullRelayMessages(options: {
  pool: RelayPool;
  eventStore: EventStore;
  relayUrls: string[];
  filters: NostrFilter[];
  callback: RelayItemCallback;
}): { unsubscribe(): void } {
  const relayUrls = [...new Set(options.relayUrls)];
  const delivered = new Set<string>();
  const reachedInitialBarrier = new Set<string>();

  let eoseSent = false;
  let closed = false;

  const emitEoseOnce = () => {
    if (closed || eoseSent) return;
    eoseSent = true;
    options.callback("EOSE");
  };

  if (relayUrls.length === 0) {
    queueMicrotask(emitEoseOnce);
    return {
      unsubscribe() {
        closed = true;
      },
    };
  }

  const rxSubscription = options.pool
    .req(relayUrls, options.filters, {
      reconnect: true,
    })
    .subscribe({
      next(message) {
        if (closed) return;

        switch (message.type) {
          case "EVENT": {
            const admitted = options.eventStore.add(
              message.event,
              message.from,
            );

            if (!admitted) return;

            // EventStore should still see every duplicate so it can merge
            // relay provenance, but each logical subscriber receives an ID
            // only once.
            if (delivered.has(admitted.id)) return;
            delivered.add(admitted.id);

            options.callback(admitted, [message.from]);
            return;
          }

          case "EOSE":
          case "CLOSED":
          case "ERROR": {
            reachedInitialBarrier.add(message.from);

            if (
              reachedInitialBarrier.size >= relayUrls.length
            ) {
              emitEoseOnce();
            }
            return;
          }

          case "OPEN":
          default:
            return;
        }
      },

      error() {
        emitEoseOnce();
      },

      complete() {
        emitEoseOnce();
      },
    });

  return {
    unsubscribe() {
      if (closed) return;
      closed = true;
      rxSubscription.unsubscribe();
    },
  };
}
```

The implementation MUST treat EOSE as an initial-history barrier, not as automatic subscription closure. Live events may continue after aggregate EOSE.

The implementation MUST emit aggregate EOSE at most once, including across reconnects.

---

## 14. Kehto NAP-RELAY service

Kehto supplies `createRelayPoolService()` with this core contract:

```ts
interface RelayPoolServiceOptions {
  subscribe(
    filters,
    callback,
    relayUrls?,
  ): { unsubscribe(): void };

  publish(event): void | Promise<void>;

  selectRelayTier(filters): string[];

  isAvailable(): boolean;
}
```

The service handles lifecycle, a 15-second EOSE fallback, observed-relay sidecars, and per-window cleanup. It receives already signed events for publication.

### 14.1 Service wiring

```ts
import { createRelayPoolService } from "@kehto/services";

export function createApplesauceRelayService(options: {
  pool: RelayPool;
  eventStore: EventStore;
  policy: RelayPolicy;
}) {
  return createRelayPoolService({
    subscribe(filters, callback, requestedUrls) {
      const candidates =
        requestedUrls && requestedUrls.length > 0
          ? requestedUrls
          : options.policy.selectDirectReadRelays(filters);

      const relayUrls = candidates
        .map((url) =>
          options.policy.normalizeAndAllow(url, {
            operation: requestedUrls
              ? "explicit-read"
              : "read",
          }),
        )
        .filter((url): url is string => Boolean(url))
        .slice(0, options.policy.maxRelaysPerRequest);

      return subscribeWithFullRelayMessages({
        pool: options.pool,
        eventStore: options.eventStore,
        relayUrls,
        filters,
        callback,
      });
    },

    async publish(event) {
      // The event has already been signed by Kehto.
      const relayUrls =
        options.policy.selectDirectPublishRelays(event);

      if (relayUrls.length === 0) {
        throw new Error("No allowed write relays");
      }

      const responses = await options.pool.publish(
        relayUrls,
        event,
      );

      const accepted = responses.filter(
        (response) => response.ok,
      );

      if (accepted.length === 0) {
        throw new Error(
          responses
            .map(
              (response) =>
                `${response.from}: ${
                  response.message ?? "rejected"
                }`,
            )
            .join("; ") || "No relay accepted event",
        );
      }

      options.eventStore.add(
        event,
        accepted[0]?.from,
      );
    },

    selectRelayTier(filters) {
      return options.policy.selectDirectReadRelays(filters);
    },

    isAvailable() {
      return true;
    },
  });
}
```

### 14.2 Direct relay semantics

`window.napplet.relay` is for explicit relay-local behavior, diagnostics, protocol tooling, or situations where the chosen relay itself is part of the operation’s meaning. Normal author-aware reads and writes should use `outbox`. This distinction is part of the NAP guidance.

The current `createRelayPoolService.publish()` adapter receives only the signed event, not a requested relay URL. Therefore this platform defines direct `relay.publish` as publishing to the host-selected direct-write tier. A future requirement for strict publication to a caller-selected relay should be implemented only when the installed NAP and Kehto service contract support that target explicitly.

---

## 15. Kehto NAP-OUTBOX service

NAP-OUTBOX is the default generic Nostr boundary.

The host owns:

- relay-list discovery;
- fallback selection;
- deduplication;
- signature verification;
- event signing;
- read and write fanout;
- relay URL policy;
- relay-source attribution.

The NAP exposes `getEvent`, `query`, `subscribe`, `publish`, and `resolveRelays`.

### 15.1 Outbox relay-pool adapter

```ts
import type {
  OutboxRelayPool,
  RelayPoolOutboxRouterOptions,
} from "@kehto/services";

export function createApplesauceOutboxPool(options: {
  pool: RelayPool;
  eventStore: EventStore;
}): OutboxRelayPool {
  return {
    subscribe(filters, relayUrls, callback) {
      return subscribeWithFullRelayMessages({
        pool: options.pool,
        eventStore: options.eventStore,
        relayUrls,
        filters,
        callback: (item) => callback(item),
      });
    },

    async publish(event, relayUrls) {
      const responses = await options.pool.publish(
        relayUrls,
        event,
      );

      const result: Record<string, boolean> = Object.fromEntries(
        relayUrls.map((url) => [url, false]),
      );

      for (const response of responses) {
        if (response.from) {
          result[response.from] = response.ok;
        }
      }

      const accepted = responses.filter(
        (response) => response.ok,
      );

      if (accepted.length > 0) {
        options.eventStore.add(
          event,
          accepted[0]?.from,
        );
      }

      return result;
    },

    isAvailable() {
      return true;
    },
  };
}
```

Kehto’s outbox adapter contract explicitly accepts per-relay publish outcomes as `Record<string, boolean>`.

### 15.2 Router construction

```ts
import {
  createOutboxService,
  createRelayPoolOutboxRouter,
} from "@kehto/services";
import { verifyEvent } from "nostr-tools/pure";

export function createApplesauceOutboxService(options: {
  pool: RelayPool;
  eventStore: EventStore;
  policy: RelayPolicy;
  loadRelayLists: RelayPoolOutboxRouterOptions["loadRelayLists"];
  getSigner: () => ReturnType<
    typeof createKehtoSignerAdapter
  >;
}) {
  const outboxPool = createApplesauceOutboxPool({
    pool: options.pool,
    eventStore: options.eventStore,
  });

  const router = createRelayPoolOutboxRouter({
    relayPool: outboxPool,

    loadRelayLists: options.loadRelayLists,

    fallbackRelays:
      options.policy.getFallbackReadRelays(),

    signEvent: async (template) => {
      const signer = options.getSigner();

      if (!signer?.signEvent) {
        throw new Error("No active signer");
      }

      return signer.signEvent(template);
    },

    verifyEvent,

    isRelayAllowed(url) {
      return Boolean(
        options.policy.normalizeAndAllow(url, {
          operation: "read",
        }),
      );
    },

    defaultTimeoutMs: 4_000,
  });

  return createOutboxService({ router });
}
```

The Kehto outbox router retains routing ownership. Applesauce supplies networking and storage, but the host SHOULD NOT replace Kehto’s outbox policy with Applesauce’s higher-level relay-selection helpers at this boundary. Maintaining one routing owner avoids contradictory semantics.

### 15.3 Signing behavior

The outbox router MUST:

1. accept an unsigned template;
2. invoke the current signer exactly once;
3. fan out the same signed event and event ID;
4. return transport-aware results;
5. reject publication when no signer exists;
6. never expose the signer to the caller.

### 15.4 Delivery behavior

For each received event, the outbox path MUST:

- verify it;
- record observed relay provenance;
- deduplicate by event ID;
- return only the admitted event;
- treat relay hints as advisory sidecars, not signed event data;
- preserve partial/incomplete-result information supplied by the Kehto router.

An empty result after timeout must not be represented as proof that no matching event exists globally.

---

## 16. Shell-level `RelayPoolLike`

Kehto’s `ShellAdapter.relayPool.getRelayPool()` expects a smaller pool-like surface with `subscription`, `publish`, and request behavior.

Even though the registered `relay` service is the canonical Napplet path, the shell-level pool MUST still use the same underlying Applesauce pool for runtime fallback and host-internal operations.

```ts
export function createKehtoRelayPoolLike(options: {
  pool: RelayPool;
  eventStore: EventStore;
  policy: RelayPolicy;
}) {
  return {
    subscription(relayUrls: string[], filters: NostrFilter[]) {
      return {
        subscribe(observer: (item: unknown) => void) {
          const handle = subscribeWithFullRelayMessages({
            pool: options.pool,
            eventStore: options.eventStore,
            relayUrls,
            filters,
            callback: observer,
          });

          return {
            unsubscribe: () => handle.unsubscribe(),
          };
        },
      };
    },

    async publish(relayUrls: string[], event: NostrEvent) {
      const allowed = relayUrls
        .map((url) =>
          options.policy.normalizeAndAllow(url, {
            operation: "write",
          }),
        )
        .filter((url): url is string => Boolean(url));

      const results = await options.pool.publish(
        allowed,
        event,
      );

      if (!results.some((result) => result.ok)) {
        throw new Error("Publication rejected by all relays");
      }
    },

    request(relayUrls: string[], filters: NostrFilter[]) {
      return {
        subscribe(observer: {
          next(value: unknown): void;
          complete(): void;
          error(error: unknown): void;
        }) {
          const events: NostrEvent[] = [];
          const handle = subscribeWithFullRelayMessages({
            pool: options.pool,
            eventStore: options.eventStore,
            relayUrls,
            filters,
            callback(item) {
              if (item === "EOSE") {
                observer.complete();
              } else {
                events.push(item);
                observer.next(item);
              }
            },
          });

          return {
            unsubscribe: () => handle.unsubscribe(),
          };
        },
      };
    },
  };
}
```

The production wrapper must conform exactly to the installed `RelayPoolLike` TypeScript definition.

---

## 17. EventStore as Kehto worker relay

Kehto’s worker relay hook expects:

```ts
interface WorkerRelayLike {
  event(event): Promise<unknown>;
  query(req): Promise<NostrEvent[]>;
  count?(req): Promise<number>;
}
```



The Applesauce EventStore SHOULD be the backing store:

```ts
export function createEventStoreWorkerRelay(
  eventStore: EventStore,
) {
  return {
    async event(event: NostrEvent) {
      const admitted = eventStore.add(event);

      return {
        ok: Boolean(admitted),
        event: admitted ?? undefined,
      };
    },

    async query(request: unknown) {
      const filters = extractFiltersFromWorkerRequest(
        request,
      );

      return eventStore.getByFilters(filters);
    },

    async count(request: unknown) {
      const filters = extractFiltersFromWorkerRequest(
        request,
      );

      return eventStore.getByFilters(filters).length;
    },
  };
}
```

`extractFiltersFromWorkerRequest` MUST validate the current Kehto request format. It must reject malformed input rather than treating it as an unrestricted query.

The worker relay is an internal cache surface. It is not exposed directly to Napplets.

---

## 18. Identity service

The platform MUST register Kehto’s read-only identity service.

At minimum it must provide:

- current public key;
- current relay permissions;
- current profile;
- current follows;
- identity change notifications.

Kehto’s identity service supports nine read-only identity operations. `getPublicKey` and `getRelays` are derived from the host signer; profile, follows, lists, zaps, mutes, blocked users, and badges may be supplied by host providers. It never exposes signing, encryption, or decryption.

### 18.1 Wiring

```ts
import { createIdentityService } from "@kehto/services";

export function createHostIdentityService(options: {
  getSigner: () => KehtoSigner | null;
  eventStore: EventStore;
  identityLoaders: IdentityLoaders;
}) {
  return createIdentityService({
    getSigner: options.getSigner,

    async getProfile(pubkey) {
      if (!pubkey) return null;

      return options.identityLoaders.getProfile(pubkey);
    },

    async getFollows(pubkey) {
      if (!pubkey) return [];

      return options.identityLoaders.getFollows(pubkey);
    },

    async getList(listType, pubkey) {
      if (!pubkey) return [];

      return options.identityLoaders.getList(
        listType,
        pubkey,
      );
    },

    async getMutes(pubkey) {
      if (!pubkey) return [];

      return options.identityLoaders.getMutes(pubkey);
    },

    async getBlocked(pubkey) {
      if (!pubkey) return [];

      return options.identityLoaders.getBlocked(pubkey);
    },

    async getBadges(pubkey) {
      if (!pubkey) return [];

      return options.identityLoaders.getBadges(pubkey);
    },

    async getZaps(pubkey) {
      if (!pubkey) return [];

      return options.identityLoaders.getZaps(pubkey);
    },
  });
}
```

The host providers SHOULD use the shared EventStore first and Applesauce loaders second. They MUST NOT create separate relay pools.

### 18.2 Signed-out sentinel

The current Kehto identity service returns an empty public-key string when no signer is connected. Napplet code must treat:

```ts
pubkey === ""
```

as signed out.

---

## 19. ShellAdapter assembly

A representative adapter is:

```ts
import {
  createShellBridge,
  type ShellAdapter,
} from "@kehto/shell";
import { verifyEvent } from "nostr-tools/pure";

export function createPlatformBridge(deps: {
  engine: NostrEngine;
  relayPolicy: RelayPolicy;
  relayConfiguration: RelayConfigurationStore;
  windowManager: HostWindowManager;
  intentRegistry: HostIntentRegistry;
  linkBackend: HostLinkBackend;
  configBackend: HostConfigBackend;
  getSigner: () => KehtoSigner | null;
}) {
  const relayPoolLike = createKehtoRelayPoolLike({
    pool: deps.engine.relayPool,
    eventStore: deps.engine.eventStore,
    policy: deps.relayPolicy,
  });

  const workerRelay = createEventStoreWorkerRelay(
    deps.engine.eventStore,
  );

  const tracked = new Map<string, () => void>();

  const adapter: ShellAdapter = {
    relayPool: {
      getRelayPool: () => relayPoolLike,

      trackSubscription(key, cleanup) {
        tracked.get(key)?.();
        tracked.set(key, cleanup);
      },

      untrackSubscription(key) {
        tracked.get(key)?.();
        tracked.delete(key);
      },

      openScopedRelay(
        windowId,
        relayUrl,
        subId,
        filters,
        sendToNapplet,
      ) {
        // Implement only if the platform supports scoped relay
        // sessions. Otherwise fail closed.
      },

      closeScopedRelay(windowId) {
        // Close the window's scoped relay, if any.
      },

      async publishToScopedRelay(windowId, event) {
        // Return false when no authorized scoped relay exists.
        return false;
      },

      selectRelayTier(filters) {
        return deps.relayPolicy
          .selectDirectReadRelays(filters);
      },
    },

    relayConfig: {
      addRelay(tier, url) {
        deps.relayConfiguration.add(tier, url);
      },

      removeRelay(tier, url) {
        deps.relayConfiguration.remove(tier, url);
      },

      getRelayConfig() {
        return deps.relayConfiguration.snapshot();
      },

      getNip66Suggestions() {
        return deps.relayConfiguration
          .getSuggestions();
      },
    },

    windowManager: {
      createWindow(options) {
        return deps.windowManager.create(options);
      },
    },

    auth: {
      getUserPubkey() {
        return deps.engine.accounts.active?.pubkey ?? null;
      },

      getSigner() {
        return deps.getSigner();
      },
    },

    config: {
      getNappUpdateBehavior() {
        return deps.configBackend
          .getNappletUpdateBehavior();
      },
    },

    hotkeys: {
      executeHotkeyFromForward(event) {
        deps.windowManager.executeHotkey(event);
      },
    },

    workerRelay: {
      getWorkerRelay() {
        return workerRelay;
      },
    },

    crypto: {
      async verifyEvent(event) {
        return verifyEvent(event);
      },
    },

    intent: {
      isAvailable() {
        return deps.intentRegistry.isReady();
      },
    },

    link: {
      isAvailable() {
        return deps.linkBackend.isReady();
      },
    },

    capabilities: {
      resolveEnvironment(identity, available) {
        return resolveNappletEnvironment(
          identity,
          available,
        );
      },
    },

    onAclCheck(event) {
      auditAclDecision(event);
    },

    onUnroutedMessage(info) {
      auditUnroutedMessage(info);
    },
  };

  return createShellBridge(adapter);
}
```

The installed `ShellAdapter` type MUST be treated as authoritative. The adapter currently requires relay, relay configuration, window management, auth, configuration, hotkey, worker-relay, and cryptographic hooks, with optional availability hooks for additional domains.

---

## 20. Service registration

All services MUST be registered before loading Napplets.

```ts
export function registerPlatformServices(options: {
  bridge: ReturnType<typeof createShellBridge>;
  relayService: ReturnType<
    typeof createApplesauceRelayService
  >;
  outboxService: ReturnType<
    typeof createApplesauceOutboxService
  >;
  identityService: ReturnType<
    typeof createHostIdentityService
  >;
  themeService: unknown;
  configService: unknown;
  resourceService: unknown;
  intentService: unknown;
  linkService: unknown;
}) {
  const runtime = options.bridge.runtime;

  runtime.registerService(
    "relay",
    options.relayService,
  );

  runtime.registerService(
    "outbox",
    options.outboxService,
  );

  runtime.registerService(
    "identity",
    options.identityService,
  );

  runtime.registerService(
    "theme",
    options.themeService,
  );

  runtime.registerService(
    "config",
    options.configService,
  );

  runtime.registerService(
    "resource",
    options.resourceService,
  );

  runtime.registerService(
    "intent",
    options.intentService,
  );

  runtime.registerService(
    "link",
    options.linkService,
  );
}
```

`storage` and core INC behavior are runtime-owned and do not need Applesauce adapters. The shell capability environment must nevertheless advertise them truthfully.

An optional domain MUST NOT be advertised unless its real backend is installed and available. Kehto explicitly applies this fail-closed rule to optional services.

---

## 21. Capability profile: `platform-nap-v1`

### 21.1 Protocol-mandatory domain

| Domain | Status | Required behavior |
|---|---|---|
| `shell` | Protocol mandatory | Capability discovery through `shell.supports(domain)` and shell environment initialization |

Kehto injects mandatory NAP-SHELL plus optional domains before authored Napplet scripts run.

### 21.2 Platform-required domains

The following domains MUST be available in every production host implementing `platform-nap-v1`:

| Domain | Purpose | Minimum operations the Napplet may rely on |
|---|---|---|
| `identity` | Read current user information | `getPublicKey`, `getRelays`, `getProfile`, `getFollows`, `onChanged` |
| `outbox` | Default routed Nostr access | `getEvent`, `query`, `subscribe`, `publish`, `resolveRelays` |
| `relay` | Explicit relay-local access | `subscribe`, `query`, `publish`, `publishEncrypted`, close handles |
| `storage` | Isolated Napplet state | `getItem`, `setItem`, `removeItem`, `keys` |
| `resource` | Mediated byte retrieval | `info`, `bytes`, `bytesMany`, `bytesAsObjectURL` |
| `config` | Shell-owned Napplet settings | `subscribe`, `openSettings` |
| `theme` | Shell theme integration | `get`, `onChanged` |
| `intent` | Role-based application dispatch | `available`, `open`, `invoke`, `handlers`, `onChanged` |
| `inc` | Runtime-attested inter-Napplet events | `emit`, `on` |
| `link` | Policy-mediated external navigation | `open` |

The current NAP reference describes these domains as injected objects under `window.napplet`, with `outbox` as the default routed Nostr boundary, `relay` as the low-level relay-local boundary, `resource` as the sandboxed byte-fetching primitive, and `identity` as strictly read-only.

### 21.3 Platform-optional domains

These MAY be added without changing `platform-nap-v1`:

| Domain | Typical purpose |
|---|---|
| `notify` | Notifications and badges |
| `upload` | NIP-96 or Blossom upload mediation |
| `count` | Exact or approximate event counts |
| `keys` | Shell-level keyboard actions |
| `media` | Media session ownership |
| `common` | Higher-level social operations |
| `lists` | Mediated list mutations |
| `dm` | Private-message operations |
| `fs` | Virtual filesystem |
| `serial` | Serial hardware |
| `ble` | Bluetooth LE |
| `webrtc` | WebRTC sessions |
| `cvm` | ContextVM/MCP bridge |

A Napplet agent MUST NOT assume any optional domain is present unless its manifest declares it and runtime feature detection succeeds.

### 21.4 Capability narrowing

The host MAY narrow the available environment for a specific verified Napplet identity.

The result MUST be the intersection of:

```text
actually wired host domains
∩ host platform policy
∩ Napplet manifest requirements
∩ per-Napplet ACL grants
∩ current user consent
```

Kehto’s `resolveEnvironment` hook may remove available domains or services but cannot add unwired capabilities.

---

## 22. Napplet manifest requirements

A Napplet MUST declare every NAP it requires in its manifest build configuration. It SHOULD request only capabilities it actually uses. Kehto’s integration guidance requires manifests to declare NAP requirements and code to feature-detect injected domains.

An application using the complete platform profile may declare:

```ts
import { defineConfig } from "vite";
import { napplet } from "@napplet/vite-plugin";

export default defineConfig({
  plugins: [
    napplet({
      artifactMode: "single-file",

      requires: [
        "identity",
        "outbox",
        "relay",
        "storage",
        "resource",
        "config",
        "theme",
        "intent",
        "inc",
        "link",
      ],
    }),
  ],
});
```

A smaller Napplet should remove unused domains.

---

## 23. Agent-facing runtime assertion

The host project SHOULD provide a tiny contract package to application agents:

```ts
export const PLATFORM_REQUIRED_DOMAINS = [
  "identity",
  "outbox",
  "relay",
  "storage",
  "resource",
  "config",
  "theme",
  "intent",
  "inc",
  "link",
] as const;

export type PlatformRequiredDomain =
  (typeof PLATFORM_REQUIRED_DOMAINS)[number];

export function assertPlatformNapV1(): void {
  const napplet = window.napplet;

  if (!napplet?.shell) {
    throw new Error(
      "Missing mandatory NAP-SHELL environment",
    );
  }

  const missing = PLATFORM_REQUIRED_DOMAINS.filter(
    (domain) =>
      !napplet.shell.supports(domain) ||
      typeof napplet[domain] !== "object",
  );

  if (missing.length > 0) {
    throw new Error(
      `Host does not satisfy platform-nap-v1: ${missing.join(
        ", ",
      )}`,
    );
  }
}
```

Application code MUST still feature-detect optional domains.

---

## 24. Napplet programming rules

The following rules are part of the agent handoff.

### 24.1 Required behavior

A Napplet implementation MUST:

1. Use `window.napplet.<domain>` or the matching current `@napplet/nap`/SDK helper.
2. Declare used domains in its manifest.
3. Treat every NAP call as asynchronous unless documented otherwise.
4. close every subscription when its view is destroyed;
5. use `outbox` for ordinary routed reads and writes;
6. use `relay` only when a specific relay or relay-local behavior matters;
7. publish unsigned event templates;
8. treat identity as read-only;
9. store local UI state through `storage`;
10. fetch bytes through `resource`;
11. open external URLs through `link`;
12. treat INC and intent payloads as untrusted input;
13. validate all cross-Napplet payloads;
14. treat relay sidecars as advisory;
15. handle signed-out state;
16. handle partial, timed-out, denied, and unavailable operations.

### 24.2 Prohibited behavior

A Napplet implementation MUST NOT:

```text
import Applesauce to create its own RelayPool
create WebSocket relay connections
access window.nostr
hold or request private keys
sign events locally
decrypt through a raw signer
use localStorage
use sessionStorage
use IndexedDB directly
send raw postMessage NAP envelopes
assume allow-same-origin
use fetch as an external-resource bypass
treat one relay's EOSE as global completeness
assume publication is all-or-nothing
trust event sidecar data as signed event data
trust INC sender fields supplied by payload
```

Kehto’s Napplet integration documentation explicitly prohibits direct WebSockets, direct browser persistence, direct signing primitives, `window.nostr`, and same-origin assumptions.

### 24.3 Allowed local libraries

A Napplet MAY bundle:

- presentation frameworks;
- Markdown renderers;
- schema validators;
- pure Nostr encoding and decoding helpers;
- event-shape parsers;
- deterministic reducers;
- application state management.

It MUST NOT use those libraries to bypass host signing, network, storage, or resource policy.

---

## 25. Generic Napplet usage examples

### 25.1 Identity

```ts
const pubkey =
  await window.napplet.identity.getPublicKey();

if (!pubkey) {
  renderSignedOutState();
}

const relays =
  await window.napplet.identity.getRelays();

const profile =
  await window.napplet.identity.getProfile();

const identitySubscription =
  window.napplet.identity.onChanged(
    (nextPubkey) => {
      resetAccountScopedState();
      loadForIdentity(nextPubkey);
    },
  );
```

### 25.2 Routed query

```ts
const result =
  await window.napplet.outbox.query(
    [
      {
        authors: [somePubkey],
        limit: 50,
      },
    ],
    {
      authors: [somePubkey],
      timeoutMs: 4_000,
    },
  );

for (const event of result.events) {
  ingestIntoApplicationProjection(event);
}
```

### 25.3 Routed live subscription

```ts
const subscription =
  window.napplet.outbox.subscribe(
    [
      {
        authors: [somePubkey],
        since: Math.floor(Date.now() / 1000),
      },
    ],
    {
      authors: [somePubkey],
    },
  );

subscription.on("event", (result) => {
  ingestIntoApplicationProjection(
    result.event,
  );

  observeRelayHints(
    result.sidecar?.relayHints ?? [],
  );
});

subscription.on("closed", (reason) => {
  displaySubscriptionState(reason);
});

// During component teardown:
subscription.close();
```

The exact listener and close methods MUST follow the installed `@napplet/nap` SDK types.

### 25.4 Publishing

```ts
const publishResult =
  await window.napplet.outbox.publish({
    kind: eventKind,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  });

if (!publishResult.ok) {
  showPublishError(publishResult.error);
  return;
}

useCanonicalEvent(publishResult.event);
```

The Napplet MUST use the signed event returned by the host as canonical. It should not calculate or predict the event ID locally.

### 25.5 Explicit relay-local subscription

```ts
const relaySubscription =
  window.napplet.relay.subscribe(
    [
      {
        kinds: [eventKind],
        limit: 20,
      },
    ],

    (result) => {
      ingestIntoApplicationProjection(
        result.event,
      );
    },

    () => {
      markInitialHistoryComplete();
    },

    {
      relay: explicitRelayUrl,
    },
  );

// During teardown:
relaySubscription.close();
```

### 25.6 Scoped storage

```ts
await window.napplet.storage.setItem(
  "view-state",
  JSON.stringify(viewState),
);

const stored =
  await window.napplet.storage.getItem(
    "view-state",
  );

const keys =
  await window.napplet.storage.keys();
```

NAP storage is scoped by Napplet identity rather than acting as global browser storage.

### 25.7 Resource fetching

```ts
const blob =
  await window.napplet.resource.bytes(
    imageReference,
  );

const managed =
  window.napplet.resource.bytesAsObjectURL(
    imageReference,
  );

image.src = managed.url;

image.addEventListener(
  "load",
  () => managed.revoke(),
  { once: true },
);
```

### 25.8 Intent and INC

```ts
const available =
  await window.napplet.intent.available(
    targetArchetype,
  );

if (available.available) {
  await window.napplet.intent.open(
    targetArchetype,
    validatedPayload,
    {
      convention: conventionUri,
    },
  );
}
```

```ts
const incSubscription =
  window.napplet.inc.on(
    conventionTopic,
    (event) => {
      // event.sender is runtime-attested.
      // event.payload remains untrusted and must be validated.
      handleValidatedPayload(
        validatePayload(event.payload),
      );
    },
  );
```

NAP-INC routing uses exact topic equality, and Kehto supplies sender identity from the authenticated endpoint rather than trusting a sender value inside the payload.

---

## 26. Event and result boundary

### 26.1 Data allowed across the boundary

The host MAY deliver:

- verified raw Nostr events;
- event templates returned as signed events;
- NIP-01 filters;
- strings, numbers, booleans, arrays, and plain objects;
- Blob values through the resource API;
- advisory relay hints;
- typed NAP errors and status fields;
- runtime-attested Napplet sender identity.

### 26.2 Data forbidden across the boundary

The host MUST NOT deliver:

- secret keys;
- signer objects;
- Accounts or AccountManager;
- Relay or RelayPool;
- RxJS subjects or observables;
- EventStore;
- database records containing private host metadata;
- browser extension objects;
- relay authentication tokens;
- local filesystem handles unless a dedicated NAP explicitly defines them;
- arbitrary host exceptions with sensitive stack traces.

### 26.3 Relay provenance

Observed relay URLs are sidecar metadata.

They mean:

```text
“The host observed this event from this relay.”
```

They do not mean:

```text
“The event author endorsed this relay.”
“The relay is trustworthy.”
“The relay is the canonical source.”
“The event is globally available.”
```

The EventStore SHOULD retain the union of relays on which a duplicate event was observed. Applesauce explicitly merges seen-relay provenance for duplicate events.

---

## 27. Publication semantics

### 27.1 Direct relay publication

For the generic direct relay service:

- the host selects the write tier;
- Kehto signs before invoking the relay service;
- Applesauce publishes the same signed event to all selected relays;
- success requires at least one accepted publication;
- zero accepted publications produces failure;
- detailed per-relay outcomes remain host telemetry unless the NAP result exposes them.

### 27.2 Outbox publication

For outbox publication:

- the router determines author write and recipient read destinations;
- caller hints are policy-gated;
- the template is signed once;
- the same signed event is fanned out;
- per-relay outcomes are returned to the router;
- missing required routing information must not silently become success;
- accepted publication is inserted into the EventStore.

### 27.3 Retry behavior

A retry MUST reuse the same deterministic signed event when the template and signer result are unchanged.

The host MUST avoid creating a new event with a new timestamp merely because a relay timed out, unless the user explicitly initiates a new publication.

### 27.4 Local optimistic state

A Napplet MAY show an optimistic pending state, but it MUST replace it with the host-returned signed event.

Failed publications must remain visibly failed or retryable. They must not be shown as successfully published.

---

## 28. Query and subscription semantics

### 28.1 Deduplication

Each logical query or subscription MUST emit a given event ID at most once.

The EventStore must still receive duplicate observations so it can merge provenance.

### 28.2 EOSE

For a multi-relay operation:

```text
aggregate EOSE =
    all selected relays returned EOSE
    OR all remaining relays closed/failed
    OR the host deadline expired
```

EOSE means initial stored results have ended for the selected relay plan. It does not mean the result is globally complete.

### 28.3 Timeouts

A timeout MUST result in one of:

- an explicit partial/incomplete result;
- a closed-subscription reason;
- a typed operation failure.

It MUST NOT silently fabricate global completeness.

### 28.4 Cancellation

Closing a Napplet handle MUST:

- unsubscribe the Applesauce RxJS subscription;
- send relay close messages as necessary;
- remove Kehto lifecycle tracking;
- clear timers;
- prevent late delivery to the destroyed window.

### 28.5 Backpressure

The host SHOULD apply:

- per-Napplet event-rate limits;
- bounded queues;
- maximum buffered bytes;
- slow-consumer detection;
- subscription cancellation on persistent overload.

The host MUST not allow one Napplet to exhaust the shared relay engine.

---

## 29. Resource and network mediation

The resource service is the only external byte-fetch primitive available to the sandboxed Napplet under this profile.

It MUST:

- support only configured schemes;
- gate hosts and URLs;
- enforce maximum response sizes;
- enforce MIME policies;
- apply timeouts;
- strip credentials;
- avoid forwarding ambient host cookies;
- validate redirects;
- return opaque errors;
- track and revoke generated object URLs.

The link service MUST:

- perform user-visible navigation;
- validate the target scheme;
- use opener isolation;
- optionally prompt;
- never return fetched content;
- distinguish denial from browser failure.

Byte retrieval and navigation are separate capabilities.

---

## 30. Napplet persistence

### 30.1 Scope

Napplet storage MUST be scoped by at least:

```text
(dTag, aggregateHash)
```

This prevents one installed artifact version from silently inheriting incompatible state from another unless migration is explicitly supported.

### 30.2 Data ownership

Napplet storage is owned by the Napplet identity but physically controlled by the host.

A Napplet MUST NOT use Nostr events as an accidental replacement for local UI state, and it MUST NOT use local UI state as authoritative Nostr state.

### 30.3 Quotas

The host SHOULD define:

```text
default per-Napplet quota
maximum item size
maximum key count
total storage cap
eviction policy
migration policy
```

Quota failures must be explicit.

---

## 31. Intent and inter-Napplet lifecycle

### 31.1 Intent backend

The intent service MUST be backed by a host registry capable of:

- enumerating installed Napplets;
- reading manifest archetypes and conventions;
- selecting a user default;
- presenting “open with” selection;
- creating or focusing a window;
- waiting for the target Napplet to become ready;
- dispatching the payload;
- returning the selected handler and result;
- responding to install/default changes.

### 31.2 INC backend

INC MUST:

- route only exact stable topics;
- bind the sender to the authenticated source window;
- reject malformed convention URIs;
- isolate subscriptions by lifecycle;
- remove listeners when a window is destroyed;
- never allow payload-provided sender spoofing.

### 31.3 Payload rules

Intent and INC payloads:

- MUST be structured-clone-safe;
- SHOULD contain references rather than large duplicated state;
- MUST be schema-validated by the receiver;
- MUST NOT carry secrets;
- MUST NOT be treated as canonical Nostr data without independent resolution.

---

## 32. Capability and consent policy

The host MUST maintain a policy per verified Napplet identity:

```ts
interface NappletIdentity {
  pubkey: string;
  dTag: string;
  hash: string;
}
```

Policy decisions SHOULD be auditable by:

```text
identity
requested domain
requested operation
decision
reason
timestamp
user consent record
```

Sensitive operations should support:

- always allow;
- ask each time;
- allow for this installed hash;
- deny;
- revoke.

A new aggregate hash SHOULD be treated as a new code identity for consent purposes unless a trusted update policy says otherwise.

---

## 33. Observability

### 33.1 Metrics

The host SHOULD record:

```text
active relay connections
relay connection state
relay authentication state
relay reconnect count
query latency
time to first event
time to aggregate EOSE
events received
events admitted
events rejected by signature
duplicate event rate
replaceable-event conflicts
publication acceptance by relay
publication total failure rate
missing relay-list rate
stale relay-list use
active Napplet subscriptions
subscription cleanup count
ACL allow/deny count
resource bytes fetched
resource policy denials
intent resolution latency
unroutable message count
```

Applesauce exposes a pool-level relay status observable suitable for host diagnostics.

### 33.2 Logging

Logs MUST NOT include:

- private keys;
- seed phrases;
- decrypted private content;
- remote-signer secrets;
- authorization headers;
- complete private event bodies;
- account persistence blobs.

### 33.3 Audit hooks

The host SHOULD implement:

```ts
onAclCheck(event)
onUnroutedMessage(info)
```

and attach correlation identifiers to NAP requests, relay operations, and host service errors.

---

## 34. Security controls

The production host MUST implement all of the following:

- opaque-origin iframe sandbox;
- verified artifact gateway;
- aggregate-hash verification;
- source-window registration;
- strict `postMessage` validation;
- CSP with `connect-src 'none'`;
- no `window.nostr`;
- no raw signer exposure;
- no direct browser persistence;
- relay URL policy;
- resource URL policy;
- filter complexity limits;
- event size limits;
- subscription count limits;
- request timeouts;
- signature verification;
- replay protection;
- per-Napplet ACL;
- consent for sensitive signing;
- account-change invalidation;
- deterministic cleanup;
- log redaction;
- isolated private data storage.

The web NAP projection defines Napplets as untrusted and assigns the shell responsibility for source binding, keys, credentials, network access, and security-critical operations.

---

## 35. Failure model

The platform MUST normalize failures into stable categories:

```ts
type PlatformFailureCode =
  | "unsupported"
  | "permission-denied"
  | "consent-denied"
  | "signed-out"
  | "signer-unavailable"
  | "invalid-request"
  | "invalid-filter"
  | "invalid-event"
  | "invalid-signature"
  | "relay-denied"
  | "relay-unavailable"
  | "relay-timeout"
  | "publish-rejected"
  | "query-timeout"
  | "resource-denied"
  | "resource-too-large"
  | "storage-quota"
  | "intent-unhandled"
  | "window-destroyed"
  | "internal-error";
```

The host MAY map these categories to the exact current NAP result envelopes.

Host stack traces MUST NOT cross into the Napplet. They should be associated with an opaque diagnostic identifier in host logs.

---

## 36. Test strategy

### 36.1 Adapter unit tests

Tests MUST cover:

- Applesauce `EVENT` mapping;
- one event from multiple relays;
- relay provenance merging;
- invalid-signature rejection;
- one aggregate EOSE;
- one relay EOSE plus another timeout;
- relay `ERROR`;
- relay `CLOSED`;
- reconnect after EOSE;
- unsubscribe before EOSE;
- publication accepted by one relay;
- publication rejected by every relay;
- empty relay selection;
- account removal during signing;
- policy-denied relay hints;
- outbox per-relay response mapping.

### 36.2 Shell integration tests

Tests MUST verify:

- service registration before load;
- `window.napplet` injection before authored code;
- mandatory `shell` presence;
- truthful `shell.supports`;
- missing required domain blocks or warns at load;
- source-window spoofing is rejected;
- a destroyed iframe receives no late messages;
- ACL denial prevents Applesauce work;
- identity changes reach only authorized live windows;
- optional services are not advertised without backends.

### 36.3 Sandbox tests

Tests MUST verify that a Napplet cannot:

- access `window.nostr`;
- access host local storage;
- open a direct WebSocket;
- bypass `resource` with `fetch`;
- inspect another Napplet’s state;
- claim another window’s identity;
- retain a working API after destruction.

### 36.4 NAP conformance

The repository SHOULD run the matching `@napplet/conformance` tooling for every exposed domain and version.

### 36.5 Relay simulation

Use deterministic mock relays covering:

```text
immediate EOSE
delayed EOSE
no EOSE
duplicate events
invalid signatures
replaceable conflicts
relay AUTH
publish OK
publish rejection
publish timeout
connection loss
reconnect
malformed protocol messages
```

---

## 37. Acceptance criteria

The platform is complete only when all of the following are satisfied:

- [ ] One shared Applesauce `RelayPool` serves every Napplet.
- [ ] One shared verified public `EventStore` serves every Napplet.
- [ ] No Napplet bundle imports Applesauce relay or account packages.
- [ ] No Napplet receives a signer or private key.
- [ ] `window.nostr` is absent inside every Napplet.
- [ ] Direct WebSocket creation is blocked inside every Napplet.
- [ ] External resource fetching is mediated by `resource`.
- [ ] External navigation is mediated by `link`.
- [ ] Kehto services are registered before any Napplet loads.
- [ ] The host uses Applesauce `req()` where EOSE and source relay are required.
- [ ] Aggregate EOSE is emitted at most once per logical subscription.
- [ ] Every incoming event is verified before delivery.
- [ ] Duplicate event IDs are delivered once per logical subscription.
- [ ] Duplicate observations still merge relay provenance.
- [ ] Losing replaceable events do not replace the valid winner.
- [ ] Deleted and expired events follow EventStore policy.
- [ ] Outbox publication signs exactly once.
- [ ] All relay fanout uses the same signed event ID.
- [ ] Publication failure is not reported as success.
- [ ] Relay hints pass through the host policy gate.
- [ ] Relay-list discovery does not recursively call outbox routing.
- [ ] Identity is read-only.
- [ ] Signed-out state is represented consistently.
- [ ] Account switching invalidates the old signer.
- [ ] Account switching notifies authorized Napplets.
- [ ] Window destruction closes every owned subscription.
- [ ] Host shutdown closes RelayPool and disposes EventStore.
- [ ] `platform-nap-v1` exposes every required domain.
- [ ] `shell.supports` accurately reflects actual wiring.
- [ ] Optional domains are absent when no backend exists.
- [ ] Every Napplet manifest declares its used domains.
- [ ] Napplet storage is isolated by verified artifact identity.
- [ ] Intent and INC payloads are validated.
- [ ] INC sender identity is supplied by the runtime.
- [ ] ACL and unrouted-message events are auditable.
- [ ] Security-sensitive values are redacted from logs.
- [ ] The complete compatibility matrix is tested in CI.

---

## 38. Required handoff to the application-Napplet agent

The agent building on this platform must receive:

### 38.1 Contract package

```text
@project/platform-nap-contract
```

containing:

- required-domain constants;
- startup assertion;
- installed NAP TypeScript types;
- common error guards;
- subscription cleanup helpers;
- payload schema helpers;
- platform compatibility version.

### 38.2 Platform declaration

The agent may rely on:

```text
window.napplet.shell
window.napplet.identity
window.napplet.outbox
window.napplet.relay
window.napplet.storage
window.napplet.resource
window.napplet.config
window.napplet.theme
window.napplet.intent
window.napplet.inc
window.napplet.link
```

The agent may not rely on any host-internal implementation.

### 38.3 Nostr boundary declaration

The agent must be told:

> Use `outbox` for normal Nostr reads and writes. Use `relay` only for explicit relay-local behavior. Publish unsigned templates. The host signs, verifies, routes, deduplicates, stores, and manages relay connections.

### 38.4 Prohibited dependency declaration

The Napplet agent must not add:

```text
applesauce-relay
applesauce-accounts
applesauce-signers
host database adapters
private-key signing libraries
relay WebSocket pools
```

to the Napplet bundle.

Pure parsing or encoding helpers are acceptable when they do not bypass the host.

### 38.5 Lifecycle declaration

The agent must:

- store every returned subscription handle;
- close handles on component unmount;
- respond to identity changes;
- reconstruct account-scoped application state after identity changes;
- revoke every resource object URL;
- treat host denials and timeouts as ordinary states.

---

## 39. End-state summary

The completed system has four clean layers:

```text
Application Napplets
    domain-specific rendering and workflows
    no keys, pools, databases, or raw network access

NAP platform contract
    identity, outbox, relay, storage, resource,
    config, theme, intent, INC, link

Kehto
    sandbox, identity binding, ACL, consent,
    signing mediation, lifecycle, service dispatch

Applesauce
    RelayPool, EventStore, accounts, signers,
    loaders, relay status, Nostr protocol transport
```

The durable design principle is:

> **Napplets describe what they need. Kehto decides whether they may do it. Applesauce performs the Nostr work.**

This separation keeps the future application layer independent of relay-library details, signer implementations, account implementations, database choices, and Kehto host internals, while preserving a strict security boundary and a stable agent-facing contract.