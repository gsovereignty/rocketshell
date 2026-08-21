# Edit Problem

Edit Problem is an intent-only napplet for publishing a new complete revision of
one NIP-1971 kind `31971` problem.

It advertises registered `composer` archetype with project-local convention
`napplet:composer/problem-edit`. This convention is not a NAP or NAAT standard.
Payload shape is exactly `{ "problemId": "<64 lowercase hex>" }`.

Normal reads and publishes use NAP-OUTBOX. Identity and authorization use
NAP-IDENTITY. Intent delivery uses NAP-INC after shell archetype routing.
After confirmed publication, NAP-INTENT focuses reused `note` handler with
confirmed revision event target so problem view returns without private shell APIs.
NAP-THEME is optional. No direct relay, browser network, or browser storage is
used.

Editor preserves current snapshot metadata and graph structure. It replaces
title, description, status, optional child default, and revision lineage. Only
current owner or listed maintainer can publish. Maintainer list stays unchanged.
