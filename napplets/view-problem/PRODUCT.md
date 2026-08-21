# View Problem

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Technical maintainers and community members inspect one NIP-1971 problem, claim
work, follow related problems, and participate in its discussion.

## Product Purpose

Provide focused, actionable detail for one logical problem while keeping all
reads, signing, relay selection, and publication behind shell-owned capabilities.

## Operating Context

The napplet opens with a NIP-1971 problem coordinate. It shows the selected
current revision, workflow state, related problem references, and NIP-22 kind
`1111` discussion and workflow events.

## Capabilities and Constraints

- Independently buildable packaged napplet using public napplet SDK contracts.
- Reads and publishes only through NAP-OUTBOX; user identity through NAP-IDENTITY.
- Resolves current direct child heads before rendering workflow actions. Any
  problem with children cannot publish a claim event.
- Child problem composition uses the existing project-local
  `napplet:composer/problem-child` convention through NAP-INTENT.
- Problem editing uses project-local `napplet:composer/problem-edit` through
  NAP-INTENT. Edit remains visible but disabled unless current identity is the
  problem owner or a maintainer listed by current revision.
- Registers the standard `note` archetype and accepts `napplet:note/open` event
  targets so problem navigators can open a selected revision in focused detail.
- Shows each comment author's shortened pubkey and a deterministic generated
  avatar without requesting profile metadata or remote images.
- Native form submission is forbidden by the `allow-scripts` sandbox.
- No direct network access, browser storage, shell imports, or environment variables.

## Evidence on Hand

- User-provided problem-detail screenshot defines content hierarchy.
- Local `NIP-1971_ Problem Tracking.md` defines problem and workflow events.
- Living napplet NAP repository defines web projection and shell capabilities.
- NIP-22 defines kind `1111` comment threading.

## Product Principles

- Problem truth and available action lead.
- Protocol identifiers stay available without overwhelming main reading flow.
- Live discussion remains readable and keyboard-operable.
- Every publish state names progress, failure, and recovery.

## Accessibility & Inclusion

All actions support pointer and Enter-key activation, retain visible focus, expose
live status, reflow in narrow iframes, and respect reduced motion.
