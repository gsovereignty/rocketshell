# Kehto + Applesauce host platform

Browser-native static host for verified NIP-5D Napplets. Production files live in `apps/shell/dist` and support arbitrary base paths.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:conformance
pnpm test:browser
pnpm build
```

## Relay configuration

Set comma-separated build variables:

- `VITE_DISCOVERY_RELAYS`
- `VITE_READ_RELAYS`
- `VITE_WRITE_RELAYS`

Relay URLs pass host policy at runtime. Production deployment requires HTTPS; localhost development may use HTTP.

## Static deployment

Set Vite base for target path, build, then publish whole `apps/shell/dist` directory. Server must serve `service-worker.js` from same application scope. Do not rewrite `/__napplet__/` virtual package responses through server routes; service worker owns them.

## Compatibility

Exact versions live in `PLATFORM_COMPATIBILITY`, workspace manifests, and `pnpm-lock.yaml`. CI installs frozen lockfile, compiles import probes, runs unit/browser/conformance suites, and builds both shell and reference Napplet.

Application guidance lives in [`packages/platform-contract/README.md`](packages/platform-contract/README.md).
