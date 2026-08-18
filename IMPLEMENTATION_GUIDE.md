# Kehto + Applesauce Static Host Platform: Implementation Guide

**Status:** End-state implementation goal  
**Deployment:** Static HTTPS hosting, including GitHub Pages  
**Runtime:** Browser, service worker, sandboxed Napplet iframes  
**Primary specification:** `Kehto + Applesauce Host Platform_ End-State Specification.md`

## 1. Goal

Build a browser-native host platform where signed Napplets run as untrusted,
sandboxed applications. Kehto owns capability mediation and lifecycle.
Applesauce performs host-internal Nostr work. A service worker verifies, stores,
and serves immutable Napplet artifacts.

The platform is distributed as static files. It requires no application server,
database server, or server-side API. It MUST work from:

- GitHub Pages, including repository subpaths;
- any HTTPS static file host;
- `http://localhost` during development.

Direct `file://` execution is not required.

The durable rule is:

> Napplets describe what they need. Kehto decides whether they may do it.
> Applesauce performs Nostr work. The service worker verifies and serves
> application artifacts.

## 2. End-state architecture

```text
Static HTTPS origin
|
|-- Shell document
|   |-- window and iframe manager
|   |-- Kehto shell bridge and runtime
|   |-- capability, ACL, and consent policy
|   |-- account UI and host configuration
|   `-- host service composition root
|
|-- Service worker
|   |-- immutable shell asset cache
|   |-- verified Napplet package gateway
|   |-- virtual Napplet URLs
|   `-- atomic package-version activation
|
|-- Shared Applesauce Nostr engine
|   |-- one RelayPool
|   |-- one verified public EventStore
|   |-- one account controller
|   |-- one relay policy
|   `-- one relay-list resolver
|
`-- Sandboxed Napplet windows
    |-- opaque origin iframe
    |-- typed window.napplet API
    |-- no signer, keys, DB, or raw network
    `-- resources bound to window lifetime
```

## 3. Platform boundary

### 3.1 Host-owned objects

These objects MUST remain inside the host:

- Applesauce `RelayPool`, relay instances, groups, and status observables;
- Applesauce `EventStore` and persistent database adapters;
- account manager, accounts, and active signer;
- private keys, remote-signer credentials, and decrypted private state;
- relay policy, relay health, and relay-list cache;
- browser persistence handles;
- service-worker installation metadata;
- host exceptions and stack traces.

### 3.2 Napplet-visible API

Conforming production hosts expose:

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

Only structured-clone-safe request and result values cross the boundary.

### 3.3 Napplet execution

Every Napplet MUST run in:

```html
<iframe sandbox="allow-scripts"></iframe>
```

The host MUST NOT add `allow-same-origin`. The iframe URL is served by the
service worker, but sandboxing gives the document an opaque origin.

## 4. Repository layout

Use a TypeScript workspace with explicit ownership boundaries:

```text
apps/
  shell/
    src/
      main.ts
      bootstrap.ts
      app-shell.ts
      account-ui.ts
      diagnostics-ui.ts
    index.html
    vite.config.ts

packages/
  platform-contract/
    src/
      compatibility.ts
      domains.ts
      assertions.ts
      failures.ts
      validation.ts
      subscriptions.ts
      index.ts

  nostr-engine/
    src/
      engine.ts
      event-database.ts
      event-ingress.ts
      accounts.ts
      signer-adapter.ts
      relay-policy.ts
      relay-lists.ts
      relay-stream.ts
      relay-publish.ts
      loaders.ts
      index.ts

  kehto-adapters/
    src/
      shell-adapter.ts
      relay-pool-like.ts
      worker-relay.ts
      relay-service.ts
      outbox-service.ts
      identity-service.ts
      service-registration.ts
      capability-profile.ts
      index.ts

  host-services/
    src/
      resource-service.ts
      link-service.ts
      intent-service.ts
      config-service.ts
      theme-service.ts
      observability.ts
      lifecycle.ts
      index.ts

  napplet-gateway/
    src/
      manifest-resolver.ts
      manifest-verifier.ts
      package-installer.ts
      package-store.ts
      session-registry.ts
      window-manager.ts
      virtual-url.ts
      service-worker-protocol.ts
      index.ts

  service-worker/
    src/
      worker.ts
      shell-cache.ts
      napplet-router.ts
      response-builder.ts
      activation.ts
      protocol.ts

  test-support/
    src/
      fake-relay.ts
      fake-signer.ts
      fixture-builder.ts
      fixture-napplets.ts
      clocks.ts

tests/
  integration/
  browser/
  conformance/
  fixtures/
```

Application-specific event kinds, reducers, projections, workflows, and UI MUST
live outside these platform packages.

## 5. Dependency policy

Start from versions recorded in the end-state specification. Use an exact
lockfile. Record both compatible package lines and exact resolved versions.

Before implementation, create compile probes for:

- `ShellAdapter` required and optional members;
- bridge creation, service registration, and destruction;
- Kehto signer shape;
- relay and outbox service option types;
- `RelayPool.req()` message union;
- `RelayPool.publish()` result shape;
- `EventStore` constructor, database interface, `add()`, query, and disposal;
- account manager active-account and proxy-signer behavior.

Illustrative code in the specification MUST NOT override installed TypeScript
definitions. Package upgrades require all compile, conformance, integration, and
browser tests to pass before lockfile changes are accepted.

## 6. Static build and deployment

### 6.1 Build output

Produce only static assets:

```text
dist/
  index.html
  manifest.webmanifest
  service-worker.js
  assets/
  built-in-napplets/
```

No runtime feature may require a custom server endpoint.

### 6.2 Base-path support

All URLs MUST derive from configured application base path. Never assume `/`.
This is required for GitHub Pages repository deployments.

```ts
const applicationBase = import.meta.env.BASE_URL;

await navigator.serviceWorker.register(
  `${applicationBase}service-worker.js`,
  { scope: applicationBase },
);
```

Use hash routing for shell views. Avoid server-side history fallback.

### 6.3 HTTPS

Production deployment MUST use HTTPS. Local development MAY use
`http://localhost`, which browsers treat as eligible for service-worker use.

### 6.4 Build validation

CI MUST inspect built output and reject:

- root-relative project URLs;
- missing hashed assets;
- dynamic imports outside emitted asset graph;
- source maps containing secrets;
- service-worker scope outside configured base;
- Napplet fixture hashes that disagree with signed manifests.

## 7. Service-worker gateway

### 7.1 Responsibilities

The service worker MUST:

- cache versioned shell assets;
- serve installed Napplet artifacts from verified storage;
- expose immutable virtual URLs;
- attach restrictive response headers;
- refuse unknown packages, hashes, and artifact paths;
- coordinate version activation with the shell;
- recover all authoritative state from IndexedDB after termination.

It MUST NOT treat Cache Storage as authoritative package metadata.

### 7.2 Virtual URL format

Use base-relative immutable URLs:

```text
<base>__napplet__/<encoded-dTag>/<aggregateHash>/index.html
<base>__napplet__/<encoded-dTag>/<aggregateHash>/app.js
<base>__napplet__/<encoded-dTag>/<aggregateHash>/styles.css
```

URL segments are lookup keys only. Stored verified installation records are the
authority for identity and artifact content.

### 7.3 Response policy

Generated Napplet HTML loads the bridge prelude before authored scripts. Use a
restrictive Content Security Policy comparable to:

```text
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self';
connect-src 'none';
object-src 'none';
frame-src 'none';
base-uri 'none';
form-action 'none';
```

Return correct content types and `X-Content-Type-Options: nosniff`.

### 7.4 Service-worker updates

Do not call `skipWaiting()` automatically while windows are active.

Required update flow:

1. install new worker;
2. validate storage and protocol compatibility;
3. notify shell that update is ready;
4. let shell close or preserve user work;
5. activate worker;
6. reload shell under coordinated control.

Every shell-to-worker message includes a protocol version and request ID.
Unknown protocol versions fail explicitly.

## 8. Napplet package lifecycle

### 8.1 Installation transaction

Installation MUST follow this order:

1. resolve signed manifest;
2. verify manifest signature;
3. download or import declared artifacts;
4. verify every artifact hash;
5. compute and verify aggregate hash;
6. validate declared NAP requirements;
7. write artifacts under a staged installation ID;
8. commit immutable package metadata;
9. atomically set active version when approved;
10. notify service worker of committed installation.

Incomplete or failed staging records are never routable.

### 8.2 Immutable versions

Each aggregate hash is immutable. Updating a Napplet creates a new package
namespace. Existing windows may continue using the old hash. New windows use the
active hash. Garbage collection removes old artifacts only when no live session
or rollback record references them.

### 8.3 Window creation

Required order:

1. find active verified installation;
2. derive `(dTag, aggregateHash)` identity;
3. create window ID and session nonce;
4. register source-window identity with Kehto;
5. create sandboxed iframe;
6. assign immutable virtual URL;
7. wait for authenticated bridge readiness;
8. publish identity and theme state;
9. expose window as ready.

Navigation MUST NOT occur before identity registration.

### 8.4 Window destruction

Every window owns a disposable-resource registry. Destruction cancels:

- relay and outbox subscriptions;
- pending NAP requests;
- timers and deadlines;
- intent waits;
- INC listeners;
- generated object URLs;
- account-sensitive operations;
- message routes and lifecycle records.

Late messages and callbacks MUST be ignored after destruction.

## 9. Persistence

Use separate IndexedDB databases or strongly separated object-store groups:

```text
platform-events
  public signed Nostr events
  relay provenance
  replaceable/deletion state

platform-private
  account metadata
  signer configuration
  decrypted private projections
  secret references

napplet-packages
  verified manifests
  immutable artifacts
  active-version records
  installation transactions

napplet-state
  state partitioned by dTag + aggregateHash

platform-metadata
  schema versions
  compatibility record
  policy and consent records
```

Migrations MUST be versioned, transactional where possible, restartable, and
tested against prior supported schemas.

## 10. Shared Nostr engine

### 10.1 Ownership

Create exactly one engine per shell instance:

```ts
interface NostrEngine {
  relayPool: RelayPool;
  eventStore: EventStore;
  accounts: AccountController;
  ingress: EventIngress;
  close(): Promise<void>;
}
```

All Napplets share this engine. No adapter may create its own pool or public
event database.

### 10.2 Event ingress

All received events pass through one ingress operation. It supplies the event
and observed relay to the verified EventStore, then uses the returned admitted
value. It never assumes the input object won replacement or deduplication.

Required behavior:

- cryptographic verification before delivery;
- ID deduplication;
- replaceable-event winner selection;
- valid deletion and expiration policy;
- relay provenance merging for duplicate observations;
- no mutation with decrypted content.

### 10.3 Shutdown

Engine shutdown is idempotent. It closes the relay pool, unsubscribes status
observers, disposes the event store, stops timers, and flushes persistence work.

## 11. Account and signer model

The account controller owns available accounts, active account, signer queues,
persistence, and identity notifications.

Signer adapters MUST resolve the active signer for every operation. They MUST NOT
capture a signer permanently during startup.

On account change:

1. increment account generation;
2. invalidate old signer adapters;
3. cancel pending signing work from old generation;
4. close account-sensitive subscriptions;
5. clear or repartition decrypted state;
6. reauthenticate relay connections where required;
7. publish identity change to authorized windows;
8. require Napplets to reacquire identity state.

Long-running work records account generation at start and rejects completion if
generation changed.

## 12. Relay policy

One policy object mediates every configured, discovered, and caller-supplied URL.

It MUST:

- accept `wss:` by default;
- optionally accept `ws:` only for local development;
- reject credentials, fragments, and malformed URLs;
- normalize casing, slash form, and default ports consistently;
- apply allow and deny rules;
- deduplicate normalized URLs;
- enforce per-operation relay limits;
- distinguish discovery, read, write, explicit, and auth contexts.

Initial limits should match the specification:

```text
maximum relays per request: 10
maximum filters: 8
maximum IDs per filter: 1000
maximum authors per filter: 1000
maximum tag values per filter: 1000
default query timeout: 4000 ms
direct EOSE fallback: 15000 ms
```

Content size, concurrent subscription, event-rate, and buffered-byte limits are
configurable host policy.

## 13. Relay-list resolver

The resolver queries fixed discovery relays directly. It MUST NOT call outbox
routing to discover relay lists.

Resolution flow:

1. query EventStore for current valid replaceable winner;
2. use fresh cache when available;
3. collect missing or stale authors;
4. query fixed discovery relays through shared pool;
5. admit results through central ingress;
6. select newest admitted winner;
7. parse read/write relay tags;
8. normalize and policy-gate every URL;
9. return author-to-relays map;
10. record missing results in bounded negative cache.

Defaults:

```text
positive freshness: 15 minutes
negative freshness: 1 minute
stale usable period: 24 hours
```

## 14. Full-message relay adapter

Use Applesauce `RelayPool.req()` wherever EOSE, relay errors, closure, or source
relay attribution matters. Event-only helpers are insufficient for this boundary.

Maintain state per logical operation:

```text
selected relay set
relays reaching EOSE/error/closure
delivered event IDs
EOSE-emitted flag
closed flag
deadline timer
RxJS subscription
```

Message handling:

```text
EVENT   admit with observed relay; deliver admitted ID once
EOSE    mark source relay at initial barrier
ERROR   mark source relay unable to continue initial history
CLOSED  mark source relay unable to continue initial history
OPEN    update diagnostics only
```

Emit aggregate EOSE once when all selected relays reach a barrier or deadline
expires. EOSE ends initial history, not live subscription. Reconnects MUST NOT
emit a second aggregate EOSE.

Closing a handle clears deadline, unsubscribes RxJS work, sends relay closure as
needed, and suppresses future callbacks.

## 15. Publication

### 15.1 Signing

Napplets publish unsigned templates. Kehto performs ACL and consent checks,
resolves active signer, signs exactly once, and fans out the same signed event.

The signed host-returned event is canonical. Napplets do not predict event IDs.

### 15.2 Outcomes

Relay publication waits for transport settlement. Default success threshold is
one accepted relay, represented as configurable policy. Zero accepted relays is
failure. Outbox publication preserves per-relay outcomes for router decisions.

Accepted events are admitted to EventStore. Failed publication is never reported
as success.

### 15.3 Retry

Retry reuses the same signed event when user intent and signed template have not
changed. A relay timeout alone does not create a new timestamp or event ID.

### 15.4 Direct relay semantics

Until installed Kehto/NAP contracts support caller-selected publish targets,
`relay.publish` means publication to the host-selected direct-write tier. Do not
promise strict caller-selected publication in public API documentation.

## 16. Kehto integration

### 16.1 Shell adapter

Implement installed `ShellAdapter` type exactly. Wire:

- shared relay pool adapter;
- relay configuration store;
- window manager;
- dynamic auth and signer source;
- shell configuration;
- hotkey forwarding;
- EventStore worker relay;
- shared event verification;
- intent and link availability;
- capability narrowing;
- ACL and unrouted-message audit hooks.

### 16.2 Services

Register all required services before loading any Napplet:

```text
relay
outbox
identity
theme
config
resource
intent
link
```

Storage and INC remain Kehto runtime facilities. Advertise them only when they
are configured and usable.

### 16.3 Capability profile

`platform-nap-v1` is the intersection of:

```text
wired host domains
host platform policy
manifest requirements
per-Napplet ACL grants
current user consent
```

Optional domains are absent unless a real available backend exists. Capability
resolution may remove capabilities but cannot create unwired ones.

## 17. Required host services

### 17.1 Identity

Expose read-only public key, relay permissions, profile, follows, supported
lists, and change notifications. Empty public key means signed out. Never expose
signing, encryption, decryption, account, or signer objects.

### 17.2 Resource

Resource service is the external byte-fetch primitive for Napplets. It enforces:

- allowed schemes, hosts, and URLs;
- redirect validation at every hop;
- timeouts and response-size limits;
- MIME allow rules;
- stripped credentials and ambient cookies;
- opaque caller-facing errors;
- tracked object URLs and deterministic revocation.

### 17.3 Link

Link service performs user-visible navigation. It validates schemes, uses opener
isolation, supports optional confirmation, returns no fetched content, and
distinguishes policy denial from browser failure.

### 17.4 Storage

Napplet storage is scoped by `(dTag, aggregateHash)`. Define quotas for total
bytes, item size, key count, and eviction. Quota failures are explicit. Version
migration requires an explicit host-supported flow.

### 17.5 Intent

Intent service enumerates handlers, selects defaults, supports “open with,”
creates or focuses windows, waits for readiness, dispatches validated payloads,
and reacts to install/default changes.

### 17.6 INC

INC uses exact stable topics. Runtime binds sender identity from authenticated
window session. Payload-provided sender fields have no authority. Listener
lifetimes belong to subscribing windows.

### 17.7 Config and theme

These services expose shell-owned state and change streams. Subscriptions use the
same window cleanup registry as relay work.

## 18. Failure contract

Normalize failures to stable platform categories:

```text
unsupported
permission-denied
consent-denied
signed-out
signer-unavailable
invalid-request
invalid-filter
invalid-event
invalid-signature
relay-denied
relay-unavailable
relay-timeout
publish-rejected
query-timeout
resource-denied
resource-too-large
storage-quota
intent-unhandled
window-destroyed
internal-error
```

Map these to installed NAP envelopes. Caller-facing internal failures include an
opaque diagnostic ID, never a host stack trace.

## 19. Observability

Record at least:

- relay connection, auth, and reconnect state;
- query latency, first-event time, and aggregate EOSE time;
- received, admitted, rejected, duplicate, deleted, and expired events;
- publication acceptance and total failure by relay;
- relay-list cache hits, misses, stale use, and negative entries;
- active Napplet windows and subscriptions;
- cleanup counts and late-callback suppression;
- ACL and consent outcomes;
- resource bytes, timeouts, and policy denials;
- intent resolution latency;
- unrouted messages and protocol-version failures.

Logs redact keys, seed phrases, decrypted private content, authorization headers,
remote-signer secrets, complete private event bodies, and persistence blobs.

## 20. Startup and shutdown

### 20.1 Startup

Required sequence:

1. open persistence and run migrations;
2. create EventStore database adapter;
3. create verified EventStore;
4. create shared RelayPool;
5. restore accounts and choose active account;
6. create relay policy;
7. create relay-list resolver;
8. create signer and relay adapters;
9. create shell adapter and bridge;
10. create required host services;
11. register every service;
12. attach authenticated message handler;
13. register and validate service worker;
14. mark platform ready;
15. permit Napplet installation and window creation.

### 20.2 Shutdown

Required sequence:

1. stop new window and request creation;
2. destroy every Napplet window;
3. remove global message listeners;
4. destroy Kehto bridge;
5. unsubscribe host observables;
6. close RelayPool;
7. dispose EventStore;
8. stop timers and persistence workers;
9. flush pending durable state.

Shutdown is safe to call more than once.

## 21. Testing strategy

### 21.1 Compile-contract tests

Compile adapters against exact installed dependency types. Treat upstream type
changes as compatibility failures requiring review.

### 21.2 Unit tests

Cover:

- URL normalization and policy denial;
- filter and template limits;
- event ingress and invalid signature rejection;
- duplicate delivery with provenance merging;
- replaceable winner, deletion, and expiration behavior;
- aggregate EOSE exactly once;
- error, closure, timeout, and reconnect combinations;
- unsubscribe before EOSE;
- one-relay acceptance and total publication rejection;
- signing generation invalidation;
- relay-list positive, negative, stale, and recursive-route prevention;
- package hash verification and atomic activation;
- failure normalization and redaction.

### 21.3 Integration tests

Verify:

- services register before Napplet navigation;
- bridge prelude runs before authored code;
- `shell.supports()` matches real wiring;
- ACL denial prevents Applesauce work;
- account changes reach authorized live windows;
- destroyed windows receive no late delivery;
- optional services disappear with unavailable backends;
- worker restart recovers package state from IndexedDB;
- old and new immutable Napplet versions coexist safely.

### 21.4 Browser tests

Run Playwright against localhost and a non-root base path. Test Chromium,
Firefox, and WebKit where supported.

Verify:

- service-worker installation and controlled reload;
- GitHub Pages-style subpath behavior;
- offline shell and installed Napplet loading;
- opaque iframe origin;
- absent `window.nostr`;
- blocked direct WebSocket and external fetch inside Napplet;
- isolated browser persistence;
- source-window spoof rejection;
- resource object URL cleanup;
- update activation with active windows.

### 21.5 Relay simulator

Provide deterministic cases for immediate, delayed, and missing EOSE; duplicate
events; invalid signatures; replaceable conflicts; AUTH; publication OK,
rejection, and timeout; disconnect; reconnect; and malformed protocol messages.

### 21.6 Conformance

Run matching `@napplet/conformance` tooling for each advertised NAP domain and
dependency version.

## 22. Delivery milestones

### Milestone 1: Foundation

- workspace and static shell;
- exact lockfile and compatibility record;
- dependency compile probes;
- contract package and failure model;
- localhost and GitHub Pages-subpath CI builds.

### Milestone 2: Service-worker gateway

- shell cache;
- IndexedDB package store;
- manifest and artifact verification;
- immutable virtual routes;
- sandboxed fixture Napplet;
- coordinated worker updates.

### Milestone 3: Shared Nostr engine

- persistent verified EventStore;
- shared RelayPool;
- event ingress;
- account controller and dynamic signer;
- relay policy and relay-list resolver.

### Milestone 4: Kehto Nostr boundary

- full-message relay adapter;
- relay service;
- outbox router and service;
- shell pool-like adapter;
- worker relay;
- read-only identity service.

### Milestone 5: Complete platform profile

- resource, link, storage, config, theme, intent, and INC;
- capability narrowing;
- ACL and consent persistence;
- window-owned cleanup registry.

### Milestone 6: Hardening and handoff

- observability and redaction;
- complete browser and relay simulation suite;
- NAP conformance;
- reference Napplet;
- application-agent contract package and documentation.

## 23. First vertical slice

Before broad implementation, complete one end-to-end path:

```text
static shell loads at non-root HTTPS path
service worker registers
signed fixture package installs into IndexedDB
service worker serves immutable virtual URL
opaque iframe starts with NAP-SHELL prelude
identity.getPublicKey succeeds
outbox.query reaches shared fake RelayPool
verified EVENT reaches Napplet once
aggregate EOSE arrives once
window destruction cancels all owned work
offline reload serves shell and installed Napplet
```

This slice proves deployment, package verification, sandboxing, source binding,
Kehto dispatch, shared Applesauce integration, event admission, EOSE, lifecycle,
and offline operation.

## 24. Completion criteria

Implementation reaches end state when:

- static build deploys under arbitrary HTTPS base path;
- service worker serves only committed verified Napplet artifacts;
- package updates are atomic and immutable by aggregate hash;
- every Napplet runs in opaque-origin `allow-scripts` sandbox;
- every required `platform-nap-v1` domain is real and truthfully advertised;
- one shared RelayPool and verified public EventStore serve all Napplets;
- Napplets receive no signer, key, Applesauce object, database handle, or raw
  network capability;
- all relay URLs pass one policy gate;
- all incoming events pass central verified ingress;
- each logical operation delivers an event ID once while provenance merges;
- aggregate EOSE occurs at most once and timeout remains visibly partial;
- event templates are signed once and publication waits for transport outcome;
- account changes invalidate old-generation work;
- relay-list discovery cannot recursively use outbox routing;
- window destruction cancels every owned resource and blocks late delivery;
- host shutdown disposes all shared resources;
- package, platform, and private persistence remain isolated;
- logs and caller-facing errors expose no sensitive host state;
- compile, unit, integration, browser, relay simulation, and NAP conformance
  suites pass against exact locked dependencies;
- reference Napplet uses only platform contract and public NAP APIs.

## 25. Application developer handoff

Publish `@project/platform-nap-contract` containing:

- required-domain constants;
- compatibility version;
- startup assertion;
- installed NAP TypeScript types;
- stable failure guards;
- subscription cleanup helpers;
- structured-clone and payload validators.

Application guidance:

> Use `outbox` for normal Nostr reads and writes. Use `relay` only when relay-local
> behavior matters. Publish unsigned templates. Treat host-returned signed events
> as canonical. Close every subscription. Respond to identity changes. Store UI
> state through NAP storage. Fetch bytes through `resource`. Navigate through
> `link`. Validate all intent and INC payloads.

Napplet bundles MUST NOT add Applesauce relay, account, or signer packages;
private-key signers; host database adapters; or relay WebSocket pools.
