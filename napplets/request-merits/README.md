# Request Merits

Creates a kind `1409` request for merits earned by completed work. User reviews exact unsigned template before shell-mediated signing and OUTBOX-first publication.

Every event from this napplet includes `problem`, `a`, `merits`, and `sats`. The UI requires work value in sats and derives `merits` 1:1 from the same integer; there is no separate merits field. (`Merits.md` itself makes `sats` optional.) `solution` remains optional. URL solutions follow documented Nostrocket shape. Text solutions follow requested Hypergolic behavior and are labeled as application behavior because current `Merits.md` does not list `text` as a standardized solution subtype.

The Rocket selector defaults to the live-confirmed `31108:d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075:NOSTROCKET` coordinate. It discovers other current kind `31108` events through NAP-OUTBOX. Each choice shows its author's kind-zero profile image through NAP-RESOURCE, or a deterministic generated avatar when no image exists.

Exact persisted HumbleHorse request `023ecb4582e73fccec1ab6d8c415f0a4eae97180ff4fc06153866900273e5894` is preserved in `src/fixtures/humblehorse-merit-request.json` and used by tests.

Advertises composer convention `napplet:composer/merit-request`. Problem tracker invokes it with `{ problem: string }`; request editor validates payload and prefills work description while retaining the NOSTROCKET default and leaving work value to the user.

Sources: [Nostrocket Merits](https://github.com/nostrocket/NIPS/blob/main/Merits.md), [living NAP specifications](https://github.com/napplet/naps), and legacy reference `/Users/gareth/git/nostrocket/hypergolic/src/components/CreateMeritRequest.svelte`.

```sh
pnpm verify
pnpm test:conformance
```
