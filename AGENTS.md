# Repository instructions

## UI requirements

- For UI motion, animation, and transitions, always use GSAP whenever
  technically possible. Prefer GSAP over CSS animations and transitions.

## Configuration requirements

- Do not use environment variables.

## Shell and packaged napplet boundary

- Treat packaged napplets and the shell as separate products with a strict
  host/application boundary.
- For any task involving napplets, first check the living NAP specifications at
  `https://github.com/napplet/naps` for relevant requirements and examples.
  Base napplet design, implementation, and protocol decisions on those current
  references rather than memory, local conventions, or invented patterns.
- For protocol audits, identify and read the current governing specification
  before evaluating implementation details. Treat referenced specifications as
  dependencies only: apply their rules solely where the governing specification
  explicitly incorporates them. When summaries, linked documents, current text,
  or revision history conflict, resolve the conflict against the latest living
  governing text and its relevant revisions before reporting any finding. Never
  infer that adopting another specification's fields, tags, algorithms, or
  structure also adopts its event kinds, identifier limits, or unrelated rules.
- Never invent or present new Napplet, Nostr, NIP, NAP, manifest, event-tag, or
  wire-format conventions as standards. Every protocol field and tag shape must
  have a cited authoritative specification. If no standard exists, say so and
  use an existing standards-aligned mechanism; do not create an ad hoc field
  such as `["icon", "https://example.com/icon.png"]`.
- Packaged napplet code belongs under `napplets/<napplet>/`. It must remain
  independently buildable and deployable, and may depend only on public
  napplet SDKs and platform contracts. It must not import shell source, host
  services, adapters, the Nostr engine, shell state, or shell-only UI assets.
- Shell and host implementation belongs under `apps/shell/` and `packages/`.
  It may discover, load, sandbox, and provide declared capabilities to
  napplets, but must not contain napplet-specific application behavior or
  reach into a napplet's internal modules.
- All communication across this boundary must use the public napplet manifest,
  gateway, and platform contract. Do not bypass that contract with workspace
  imports, shared mutable state, DOM access across the boundary, or private
  implementation APIs.
- Before changing code, classify the change as shell-owned, contract-owned, or
  napplet-owned and keep implementation and tests on that side. If both sides
  must change, separate the changes and preserve dependency direction from
  napplet to public contract, never to shell implementation.

## Applesauce requirements

- For any task involving Applesauce, always activate and follow the installed
  `applesauce` skill.
- For any task involving Applesauce, always use the `applesauce` MCP server at
  `https://mcp.applesauce.build/mcp` for documentation, API, and example
  discovery.
- Never design, implement, modify, or generate Applesauce-related code before
  examining relevant real Applesauce examples through the Applesauce MCP
  server. Base work on those examples and current Applesauce APIs rather than
  memory or invented patterns.
- Always use functional programming for Applesauce-related code. Never use
  object-oriented programming, including classes, inheritance, or
  object-oriented design patterns, for anything related to Applesauce.
- Never create more than one Applesauce `EventStore`. All Applesauce-related
  code must share one application-wide `EventStore` instance.
- If the Applesauce skill or MCP server is unavailable, stop Applesauce
  implementation and report the blocker instead of building from assumptions.

## Commits

- Commit every completed change before handing work back to user.
- Keep each commit focused on one logical change.
- Write every commit message as a problem statement using this subject format:
  `problem: <affected subject> <undesirable condition or missing capability>`.
- Keep commit subjects under 50 characters when practical and never over 70
  characters.
- Describe the problem solved, not the solution, implementation, command, or
  files changed. Add a wrapped body only when needed for rationale, breaking
  changes, migrations, reverts, or issue references.
