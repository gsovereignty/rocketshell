# Design

Purpose: receive one problem by archetype intent and publish its next revision.

- Required domains: `identity`, `outbox`, `inc`.
- Optional domain: `theme`; explicit local palette remains usable without it.
- Archetype: `composer`; convention: `napplet:composer/problem-edit`.
- Intent payload: exact object containing one lowercase hexadecimal `problemId`.
- Data: query kind `31971` by `#d`, identify unique revision head, publish full
  snapshot through OUTBOX.
- Layout: full-width, single-column editing workspace at every size; controls
  stack when narrow and remain functional down to 320 CSS pixels.
- Sandbox: scripted buttons only; Ctrl/Cmd+Enter is explicitly handled; no form
  submission or ambient browser authority.
- Relay escape hatch: none.
