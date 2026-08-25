# Design

Purpose: receive one problem by archetype intent and publish its next revision.

- Required domains: `identity`, `outbox`, `inc`.
- Optional domain: `theme`; explicit local palette remains usable without it.
- Archetype: `composer`; convention: `napplet:composer/problem-edit`.
- Intent payload: exact object containing one lowercase hexadecimal `problemId`.
- Data: query kind `31971` by `#d`, identify unique revision head, publish full
  snapshot through OUTBOX. Owner-only direct-parent edits resolve current heads,
  full ancestry, graph root, relay hints, and genesis IDs from loaded graph data
  before rebuilding unmarked lowercase `a/e/k/p` groups.
- Layout: full-width, single-column editing workspace at every size; controls
  stack when narrow and remain functional down to 320 CSS pixels. Direct parents
  remain visible as an inline list with exact-coordinate add/remove controls; no
  modal.
- Sandbox: scripted buttons only; Ctrl/Cmd+Enter is explicitly handled; no form
  submission or ambient browser authority.
- Relay escape hatch: none.
