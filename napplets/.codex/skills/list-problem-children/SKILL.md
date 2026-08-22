---
name: list-problem-children
description: Resolve full or abbreviated NIP-1971 problem IDs and list every current direct child from Nostr author outboxes. Use when asked to examine, find, enumerate, or list children, subproblems, or immediate descendants of a kind 31971 problem, especially IDs written like `9996a3d2…d8332`.
---

# List Problem Children

Run bundled script:

```bash
bash scripts/list-problem-children.sh '<full-or-abbreviated-problem-id>'
```

Resolve script path relative to this `SKILL.md`, regardless of current working directory.

The script:

1. Resolves an exact 64-character lowercase ID or an abbreviation containing `…`, `...`, or a single prefix.
2. Finds parent owner from kind `31971` current revisions.
3. Reads both default discovery relays and public NIP-65 author relays.
4. Selects direct children through exact unmarked lowercase `a` parent-coordinate tags.
5. Deduplicates relay copies and collapses revision chains to unreferenced current heads.
6. Prints title, status, abbreviated logical problem ID, full problem ID, event ID, and description.

Report child count and rendered list. Call them **direct children**. Do not describe recursive descendants as included.

If command fails, report shortest exact error. Never guess missing IDs, owners, relays, children, or revision heads.

## Requirements

- `nak`
- `jq`
- Network access to Nostr relays

This is read-only. Do not publish events or request signing keys.
