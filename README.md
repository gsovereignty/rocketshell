# Kehto + Applesauce host platform

## Build

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:conformance
pnpm test:browser
pnpm build
```

Production files are written to `apps/shell/dist`. The default build uses `/`
as its base path; `pnpm --filter @platform/shell build:github` uses `/shell/`.

## Implemented NAP specifications

- **NAP-SHELL** (`shell`): readiness handshake, per-Napplet capability
  negotiation, synchronous capability discovery, and advertised host services.
- **NAP-IDENTITY** (`identity`): active public key and change notifications;
  NIP-65 relay permissions; profile, follows, categorized lists, zaps, mutes,
  blocked users, and NIP-58 badges. Queries use the shared event cache and
  fetch missing data from host relays.
- **NAP-OUTBOX** (`outbox`): outbox-aware queries, subscriptions, publication,
  relay-list resolution, fallback routing, event verification, and lifecycle
  cleanup.
- **NAP-RELAY** (`relay`): mediated subscriptions, queries, publication,
  signing, encryption, relay-tier selection, EOSE handling, and subscription
  cleanup.
- **NAP-STORAGE** (`storage`): persistent key-value storage scoped to the
  runtime-attested Napplet identity.
- **NAP-RESOURCE** (`resource`): policy-controlled metadata and byte fetching
  for HTTPS, approved localhost development URLs, and granted package origins.
- **NAP-CONFIG** (`config`): scoped configuration reads, writes, schemas, and
  host-rendered settings editing.
- **NAP-THEME** (`theme`): current-theme queries and automatic theme-change
  broadcasts.
- **NAP-INTENT** (`intent`): installed-handler discovery, defaults, chooser and
  explicit-handler authorization, archetype dispatch, window reuse or creation,
  and ready-gated payload delivery.
- **NAP-INC** (`inc`): exact-match topics, subscriptions, authenticated sender
  attribution, peer channels, broadcast, listing, closure, and window-lifecycle
  cleanup.
- **NAP-LINK** (`link`): confirmed external navigation with protocol and URL
  policy enforcement.
- **NAP-UPLOAD** (`upload`): shell-mediated Blossom upload and authorization.
  The active account's BUD-03 server list takes precedence over fallback
  servers configured in shell preferences.

Every domain is granted only when declared by the signed NIP-5D manifest. A
package requiring an unavailable domain is rejected before its code runs.

## Relay configuration

The shell uses public relay defaults on first run. Configure backup relays,
lookup relays, and fallback Blossom servers through **Preferences** in the
profile menu. Settings persist in browser storage. A connected account's
published NIP-65 inbox/outbox lists and lookup-relay list take precedence over
the corresponding fallback settings.

Relay and Blossom URLs pass host policy at runtime. Production deployment
requires secure URLs; localhost development may use plaintext URLs.

## Open a Napplet

Start development mode:

```sh
pnpm dev
```

Paste a named NIP-5D coordinate into the loader:

```text
35129:266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5:good-morning
```

Coordinates also work as deep links through the `napplet` query parameter. The
shell resolves the latest signed manifest, downloads artifacts only from signed
server hints, verifies every artifact and aggregate hash, commits atomically,
then opens the verified package.

## Built-in Napplets

Napplet source, authoring documentation, and examples live only under
[`napplets/`](napplets/). Workspace packages named `@platform/*-napplet` build
before the shell. Mark a
package as loadable by adding `napplet` metadata to its `package.json` with a
stable `dTag`, title, required domains, and optional archetype conventions. Its
build must produce `dist/index.html`.

Development serves discovered artifacts under `/napplets.dev/` and generates
`/napplets.dev.json`. Production copies each complete `dist/` tree under
`apps/shell/dist/napplets/` and generates `napplets.json`. At startup, built-ins
enter the same package store, capability bridge, sandbox, and window manager as
external Napplets. See the [authoring spec](napplets/AUTHORING-SPEC.md) and
[loading architecture](napplets/LOADING-ARCHITECTURE.md).

## Static deployment

Choose the build script matching the deployment path, then publish the whole
`apps/shell/dist` directory. Server must serve `service-worker.js` from the same
application scope. Do not rewrite `/__napplet__/` virtual package responses
through server routes; service worker owns them.

## Compatibility

Exact versions live in `PLATFORM_COMPATIBILITY`, workspace manifests, and `pnpm-lock.yaml`. CI installs frozen lockfile, compiles import probes, runs unit/browser/conformance suites, and builds both shell and reference Napplet.

The supported contract is profile `platform-nap-v1`: `@napplet/nap` and
`@napplet/core` 0.31.1, Kehto runtime 0.22.0, and Kehto shell/services 0.20.0.
Application guidance lives in [`packages/platform-contract/README.md`](packages/platform-contract/README.md).
