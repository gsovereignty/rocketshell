# NOSTROCKET State design

`nostrocket-state` is a read-only ledger surface. `outbox` is required. `theme` and `resource` are optional and fall back to a complete neutral palette, shortened pubkeys, and generated avatars. No identity, signing, storage, direct relay, ambient network, or intent authority is used.

Data flow: query kind `30166` through `outbox.query`, rank readable clearnet `wss` relays by independent monitor observations, then discover kind `31108` rocket coordinates through `outbox.query`. NOSTROCKET is selected first. A missing selected event is subscribed by its exact author and `d` identifier; the first valid event closes subscription immediately. Missing NIP-66 data falls back to shell-owned author-outbox routing. Kind `1409` requests matching the selected coordinate are compared with state merit request IDs to derive pending requests. Holder/requester kind `0` metadata is queried through `outbox`; profile picture bytes flow only through optional `resource.bytes`, and object URLs are revoked on refresh or teardown.

Large layout leads with state identity, rocket selector, and totals, then pairs merit-distribution pie with ranked holders, avatars, expandable lots, pending requests, and provenance. Slice colors repeat in holder rows. Tiny layout stacks selector, chart, ledger, and pending requests. All entrance motion uses GSAP and respects reduced motion.
