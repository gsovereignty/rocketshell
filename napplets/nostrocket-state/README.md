# NOSTROCKET State napplet

Read-only static napplet for NOSTROCKET kind `31108` state.

The complete fetched reference event is checked in at `src/fixtures/nostrocket-state.json`. Event ID: `2aff6b8c5e9560dbe6cab403c0a3eea478ddfe06f1361dfb05fa582a0dddb207`. Tests use this fixture; production runtime never renders it as fallback data.

Protocol references:

- NAP-OUTBOX: https://github.com/napplet/naps/blob/master/naps/NAP-OUTBOX.md
- NIP-66: https://github.com/nostr-protocol/nips/blob/master/66.md
- Nostrocket kind 31108: https://github.com/nostrocket/NIPS/blob/main/31108.md
- Ruleset 334000: https://github.com/nostrocket/NIPS/blob/main/MSBR334000.md

Commands: `pnpm verify`, `pnpm test:conformance`.
