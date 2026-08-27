# NOSTROCKET State design

`nostrocket-state` is a read-only ledger surface. `outbox` is required. `theme` is optional and falls back to a complete neutral palette. No identity, signing, storage, direct relay, network, intent, or external-resource authority is used.

Data flow: query kind `30166` through `outbox.query`, rank readable clearnet `wss` relays by independent monitor observations then median `rtt-read`, and pass up to three into `outbox.subscribe`. State filter is kind `31108`, fixed author, `#d=NOSTROCKET`, `limit=1`. First valid event closes subscription immediately. Missing NIP-66 data falls back to shell-owned author-outbox routing, as NIP-66 requires monitoring absence not block relay connections.

Large layout leads with state identity, totals, ranked holdings, expandable lots, and provenance. Tiny layout stacks totals and compresses every holding into owner, merit, share, and progress. All entrance motion uses GSAP and respects reduced motion.
