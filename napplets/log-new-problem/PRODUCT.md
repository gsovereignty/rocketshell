# Log New Problem

## Product

Log New Problem is a single-purpose packaged napplet for creating and publishing
NIP-1971 kind `31971` problem genesis events. It creates graph-root problems when
opened directly and child problems when opened with parent context.

## Audience and job

Technical maintainers and general community members use it to describe a problem
quickly, review the resulting scope, and publish through the shell-owned Nostr
boundary without handling keys or relays directly.

## Experience

- Start with title and complete problem description.
- Keep common choices visible and move optional protocol detail behind progressive
  disclosure.
- Clearly distinguish a new root problem from a child of an existing problem.
- Receive child context from shell intent delivery as a validated problem ID.
- Resolve the parent event through the shell, derive required graph and parent tags,
  then publish an unsigned event template through the shell.
- Show pending, success, validation, missing-capability, lookup, and publish states.

## Protocol commitments

- Event shape follows the local `NIP-1971_ Problem Tracking.md` draft.
- Runtime capability use follows living NAP specifications.
- The napplet declares registered `composer` archetype because no `problem`
  archetype exists in the living registry.
- `napplet:composer/problem-child` is a project-local convention, not a NAP or
  registry standard. Payload version 1 is `{ "problemId": "<64 lowercase hex>" }`.
- Shell owns identity, signing, relay selection, querying, and publishing.

## Constraints

- Independently buildable under this directory.
- No shell imports, ambient network access, browser storage, signer, relay pool,
  or EventStore.
- Fast and minimal by default; advanced fields remain optional.
- Keyboard accessible, responsive to narrow iframe sizes, reduced-motion safe.

## Assumptions

- Initial publication status defaults to `open`.
- A child intent provides only the logical parent problem ID; parent owner,
  current revision, root coordinate, and relay hints are resolved from Nostr.
- Root problems use the active user's pubkey as owner and graph-root owner.
