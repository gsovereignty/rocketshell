# Request Merits

Creates a kind `1409` request for merits earned by completed work. User reviews exact unsigned template before shell-mediated signing and OUTBOX-first publication.

Required event tags: `problem`, `a`, and `merits`. `solution` and `sats` are optional. URL solutions follow documented Nostrocket shape. Text solutions follow requested Hypergolic behavior and are labeled as application behavior because current `Merits.md` does not list `text` as a standardized solution subtype.

Exact persisted HumbleHorse request `023ecb4582e73fccec1ab6d8c415f0a4eae97180ff4fc06153866900273e5894` is preserved in `src/fixtures/humblehorse-merit-request.json` and used by tests.

Sources: [Nostrocket Merits](https://github.com/nostrocket/NIPS/blob/main/Merits.md), [living NAP specifications](https://github.com/napplet/naps), and legacy reference `/Users/gareth/git/nostrocket/hypergolic/src/components/CreateMeritRequest.svelte`.

```sh
pnpm verify
pnpm test:conformance
```
