# Kehto + Applesauce host platform

Browser-native static host for verified NIP-5D Napplets. Production files live in `apps/shell/dist` and support arbitrary base paths.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:conformance
pnpm test:browser
pnpm test:stlstr
pnpm build
```

## Relay configuration

The shell works without environment variables. It defaults to public discovery,
read, and write relays. Override them with comma-separated build variables:

- `VITE_DISCOVERY_RELAYS`
- `VITE_READ_RELAYS`
- `VITE_WRITE_RELAYS`

Relay URLs pass host policy at runtime. Production deployment requires HTTPS; localhost development may use HTTP.

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

## Static deployment

Set Vite base for target path, build, then publish whole `apps/shell/dist` directory. Server must serve `service-worker.js` from same application scope. Do not rewrite `/__napplet__/` virtual package responses through server routes; service worker owns them.

## Compatibility

Exact versions live in `PLATFORM_COMPATIBILITY`, workspace manifests, and `pnpm-lock.yaml`. CI installs frozen lockfile, compiles import probes, runs unit/browser/conformance suites, and builds both shell and reference Napplet.

The supported contract is profile `platform-nap-v1`: `@napplet/nap` and
`@napplet/core` 0.31.1, Kehto runtime 0.22.0, and Kehto shell/services 0.20.0.
The host supplies the required NAP domains plus manifest-selected `identity`,
`outbox`, `relay`, `storage`, `resource`, `config`, `theme`, `intent`, `inc`,
and `link`. `upload` is available only when `VITE_BLOSSOM_SERVERS` contains at
least one host-approved server. A package
requiring an unavailable domain is refused before application code runs.

`pnpm test:stlstr` runs the built STLstr `stl-preview` package from
`../hzrd149/stlstr` by default. Set `STLSTR_ROOT` to validate another checkout.

Application guidance lives in [`packages/platform-contract/README.md`](packages/platform-contract/README.md).
