# Create Rocket

Creates a Sovereign Economic Community ignition event under Nostrocket MSB ruleset `334000`. User reviews exact unsigned template before shell-mediated signing and OUTBOX-first publication.

Problem and repository references are selected from current signer's own kind `31971` problems and kind `30617` NIP-34 repository announcements. Coordinates and relay hints are derived from validated events and shell-owned OUTBOX routing; users never enter protocol coordinates.

NOSTROCKET ignition event is preserved verbatim in `src/fixtures/nostrocket-ignition.json` as test fixture and structural reference. It adds no protocol link to newly created rockets because governing specs define no cross-rocket reference tag.

Required tags: `d`, `ruleset`, `ignition`, and `parent`. Optional ruleset tags use specified `mission`, `problem`, and `repo` forms.

Sources: [NIP 31108](https://github.com/nostrocket/NIPS/blob/main/31108.md), [MSBR334000](https://github.com/nostrocket/NIPS/blob/main/MSBR334000.md), and [living NAP specifications](https://github.com/napplet/naps).

```sh
pnpm verify
pnpm test:conformance
```
