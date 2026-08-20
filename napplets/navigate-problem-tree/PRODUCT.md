# Navigate Problem Tree

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain TypeScript and Vite, confirmed by user.

## Users

People exploring a NIP-1971 problem DAG to understand decomposition and move
between related problems without reading each problem in this napplet.

## Product Purpose

Load one problem DAG from a root problem `a` coordinate, expose its structure,
and let users move through direct child relationships. Success means users can
locate a problem, understand where it sits, and hand it to a focused event viewer.

## Positioning

Navigation stays separate from problem rendering. This napplet is a structural
map; a standards-aligned `note` napplet owns focused problem display.

## Operating Context

Runs as a packaged napplet inside a NAP-capable shell. A root coordinate may be
hardcoded before release; until then, users provide it at startup.

## Capabilities and Constraints

- Reads NIP-1971 kind `31971` events through shell-owned outbox access.
- Uses uppercase `A` root tags and lowercase unmarked `a` parent tags as defined
  by the local NIP-1971 draft.
- Opens selected current revisions through NAP-INTENT, registered `note`
  archetype, and `napplet:note/open` convention.
- Does not render problem descriptions or import shell implementation.
- Uses no direct network access, signer, browser storage, or environment variables.

## Evidence on Hand

- `NIP-1971_ Problem Tracking.md` supplies event and DAG rules.
- User-provided screenshot supplies approved split outline/list composition.
- Living `napplet/naps` repository supplies shell, outbox, intent, and archetype contracts.

## Product Principles

- Structure first; problem content belongs elsewhere.
- Preserve DAG truth, including shared children and revision forks.
- Make current location and available next moves obvious.
- Fail with a recovery action when root input, shell access, or handlers are missing.

## Accessibility & Inclusion

All navigation and filtering must work by keyboard, retain visible focus, expose
state to assistive technology, and respect reduced-motion preferences.
