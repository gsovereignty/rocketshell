# NIP-1971

## Problem Tracking

`draft` `optional`

Kind `31971` defines addressable problem snapshots.

Problems form:

- a revision DAG between exact kind `31971` event IDs;
- a problem DAG between logical problems.

Claims, solutions, and discussion use kind `1111` from [NIP-22](22.md).

## Kind `31971` Tags

| Requirement | Situation                                          | Tag                                                                         |
| ----------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `MUST`      | All events                                         | `["d", "<globally-unique-problem-id>"]`                                     |
| `MUST`      | All events                                         | `["title", "<title>"]`                                                      |
| `SHOULD`    | All events                                         | `["status", "<draft\|rfm\|big\|children\|open\|claimed\|patched\|closed>"]` |
| `MUST`      | All events                                         | `["a", "31971:<owner>:<problem-id>", "<relay>", "origin"]`                  |
| `MUST`      | Non-genesis revision                               | `["e", "<genesis-id>", "<relay>", "genesis", "<owner>"]`                    |
| `MUST`      | Non-genesis revision; repeat for merges            | `["e", "<previous-id>", "<relay>", "previous", "<previous-author>"]`        |
| `MUST`      | All events                                         | `["A", "31971:<graph-root-owner>:<graph-root-id>", "<relay>"]`              |
| `MUST`      | Except graph-root genesis                          | `["E", "<graph-root-genesis-id>", "<relay>", "<graph-root-owner>"]`         |
| `MUST`      | All events                                         | `["K", "31971"]`                                                            |
| `MUST`      | All events                                         | `["P", "<graph-root-owner>", "<relay>"]`                                    |
| `MUST`      | Non-root problem; repeat per direct parent         | `["a", "31971:<parent-owner>:<parent-id>", "<relay>"]`                      |
| `MUST`      | Non-root problem; repeat per direct parent         | `["e", "<parent-genesis-id>", "<relay>", "<parent-owner>"]`                 |
| `MUST`      | Non-root problem                                   | `["k", "31971"]`                                                            |
| `MUST`      | Non-root problem; repeat per distinct parent owner | `["p", "<parent-owner>", "<relay>"]`                                        |
| `SHOULD`    | Repeat per maintainer                              | `["p", "<maintainer>", "<relay>", "maintainer"]`                            |
| `MAY`       | Default for newly created children                 | `["child_status", "<rfm\|open>"]`                                           |
| `MAY`       | Rocket context                                     | `["a", "31108:<owner>:<rocket-id>", "<relay>", "rocket"]`                   |
| `MAY`       | NIP-34 repository context                          | `["a", "30617:<owner>:<repo-id>", "<relay>", "repository"]`                 |
| `SHOULD`    | All events                                         | `["bitcoin", "<height>", "<block-hash>"]`                                   |
| `MUST`      | Status is `claimed`                                | `["claim", "<claim-event-id>", "<claimant>", "<accepted-height>"]`          |
| `MUST`      | Status is `patched`                                | `["patch", "<solution-event-id>", "<solution-author>"]`                     |
| `SHOULD`    | Closed with an accepted solution                   | `["patch", "<solution-event-id>", "<solution-author>"]`                     |

All tag elements are strings.

An empty relay hint MUST be encoded as `""` when later tag positions are present.

New problem IDs SHOULD be generated from 32 random bytes encoded as lowercase hexadecimal.

## Kind `1111` Tags

| Requirement | Situation                | Tag                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------- |
| `MUST`      | All comments and actions | `["A", "31971:<owner>:<problem-id>", "<relay>"]`                 |
| `MUST`      | All comments and actions | `["K", "31971"]`                                                 |
| `MUST`      | All comments and actions | `["P", "<owner>", "<relay>"]`                                    |
| `MUST`      | All comments and actions | `["a", "31971:<owner>:<problem-id>", "<relay>"]`                 |
| `MUST`      | All comments and actions | `["e", "<current-revision-id>", "<relay>", "<revision-author>"]` |
| `MUST`      | All comments and actions | `["k", "31971"]`                                                 |
| `MUST`      | All comments and actions | `["p", "<revision-author>", "<relay>"]`                          |
| `MUST`      | Claim request            | `["claim"]`                                                      |
| `MUST`      | Proposed solution        | `["patched"]`                                                    |

General comments omit both `claim` and `patched`.

## Problem Event

```jsonc
{
  "kind": 31971,
  "pubkey": "<revision-author>",
  "created_at": 1750002000,
  "content": "Complete current problem description.",
  "tags": [
    ["d", "<problem-id>"],
    ["title", "Implement claim handling"],
    ["status", "open"],

    // Immutable identity
    ["a", "31971:<owner>:<problem-id>", "<relay>", "origin"],

    // Omit both on this problem's genesis event
    ["e", "<genesis-id>", "<relay>", "genesis", "<owner>"],
    ["e", "<previous-id>", "<relay>", "previous", "<previous-author>"],

    // Repeat "previous" for a revision merge
    // ["e", "<other-previous-id>", "<relay>", "previous", "<other-author>"],

    // Problem DAG root
    ["A", "31971:<graph-root-owner>:<graph-root-id>", "<relay>"],
    ["E", "<graph-root-genesis-id>", "<relay>", "<graph-root-owner>"],
    ["K", "31971"],
    ["P", "<graph-root-owner>", "<relay>"],

    // Omit this group for the graph-root problem.
    // Repeat a/e/p for multiple direct parents.
    ["a", "31971:<parent-owner>:<parent-id>", "<relay>"],
    ["e", "<parent-genesis-id>", "<relay>", "<parent-owner>"],
    ["k", "31971"],
    ["p", "<parent-owner>", "<relay>"],

    // Maintainers
    ["p", "<maintainer-a>", "<relay>", "maintainer"],
    ["p", "<maintainer-b>", "<relay>", "maintainer"],

    // Optional metadata
    ["child_status", "rfm"],
    ["a", "31108:<rocket-owner>:<rocket-id>", "<relay>", "rocket"],
    ["a", "30617:<repo-owner>:<repo-id>", "<relay>", "repository"],
    ["bitcoin", "900002", "<block-hash>"]

    // Include when status is "claimed"
    // ["claim", "<claim-event-id>", "<claimant>"]

    // Include when status is "patched" or solved
    // ["patch", "<solution-event-id>", "<solution-author>"]
  ]
}
```

## Event Variations

| Situation           | Required changes                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Graph-root genesis  | `pubkey` is the owner; `A` equals the origin coordinate; omit `E`, `genesis`, `previous`, and all parent tags       |
| Graph-root revision | `A` equals the origin coordinate; `E` equals its genesis ID; include `genesis` and `previous`; omit all parent tags |
| Child genesis       | Omit its own `genesis` and `previous`; include `A/E/K/P` for the graph root and at least one parent group           |
| Child revision      | Include its own `genesis`, at least one `previous`, `A/E/K/P`, and at least one parent group                        |
| Revision merge      | Include two or more `e` tags marked `previous`                                                                      |
| Multiple parents    | Repeat unmarked parent `a`, `e`, and `p`; include one `["k", "31971"]`                                              |
| Claimed             | Set status to `claimed` and include exactly one `claim` tag                                                         |
| Patched             | Set status to `patched` and include one or more `patch` tags                                                        |
| Closed as solved    | Set status to `closed` and retain accepted `patch` tags                                                             |

## Revision Rules

Every event MUST contain the complete current problem state, not a diff.

The following MUST remain unchanged across revisions:

```text
d
origin coordinate
genesis ID
graph-root A/E/K/P
```

The genesis event omits its own `genesis` and `previous` tags.

A revision author MUST be:

- the owner; or
- a maintainer listed by each referenced previous revision.

Only the owner MAY add or remove maintainers.

Maintainer-authored revisions MUST copy the previous maintainer list unchanged.

Multiple revisions referencing the same previous event are forks.

Clients SHOULD retain all known heads until a merge revision references them.

`created_at` MUST NOT be used alone to resolve forks.

## Problem DAG Rules

Uppercase `A/E/K/P` tags identify the graph root.

Unmarked lowercase `a/e/k/p` tags identify direct parents.

The graph root has no parents.

Every non-root problem has one or more parents.

The graph MUST NOT contain:

```text
self-references
duplicate logical edges
cycles
```

Parent edges are read from the selected current revision of each problem, not from the union of historical revisions.

## Workflow Event

```jsonc
{
  "kind": 1111,
  "pubkey": "<actor>",
  "created_at": 1750003000,
  "content": "<claim or solution description>",
  "tags": [
    // Problem scope
    ["A", "31971:<owner>:<problem-id>", "<relay>"],
    ["K", "31971"],
    ["P", "<owner>", "<relay>"],

    // Exact revision
    ["a", "31971:<owner>:<problem-id>", "<relay>"],
    ["e", "<current-revision-id>", "<relay>", "<revision-author>"],
    ["k", "31971"],
    ["p", "<revision-author>", "<relay>"],

    // Use one, or omit both for discussion
    ["claim"]
    // ["patched"]
  ]
}
```

| Workflow event | Accepted in the next kind `31971` revision                                      |
| -------------- | ------------------------------------------------------------------------------- |
| `["claim"]`    | `["status", "claimed"]` and `["claim", "<event-id>", "<claimant>", "<height>"]` |
| `["patched"]`  | `["status", "patched"]` and `["patch", "<event-id>", "<solution-author>"]`      |

If a claimant is unresponsive for more than `144` blocks after the accepted height, maintainers SHOULD publish a new `open` revision without the `claim` tag.

## Lifecycle

| Status     | Meaning                 | Valid next states                                 |
| ---------- | ----------------------- | ------------------------------------------------- |
| `draft`    | Incomplete              | `rfm`, `big`, `open`, `closed`                    |
| `rfm`      | Request for maintainers | `draft`, `big`, `open`, `closed`                  |
| `big`      | Needs decomposition     | `children`, `open`, `closed`                      |
| `children` | Has open child problems | `open`, `patched`, `closed`                       |
| `open`     | Available to be claimed | `big`, `children`, `claimed`, `patched`, `closed` |
| `claimed`  | Active claim            | `open`, `patched`, `closed`                       |
| `patched`  | Solution proposed       | `open`, `claimed`, `closed`                       |
| `closed`   | No longer active        | `open`                                            |

Problems SHOULD begin as `open`.

Problems too large for one short work session SHOULD use `big`.

Problems with open children SHOULD use `children`.

## Filters

All revisions of one problem:

```json
{
  "kinds": [31971],
  "#d": ["<problem-id>"]
}
```

All problems in one problem DAG:

```json
{
  "kinds": [31971],
  "#A": ["31971:<graph-root-owner>:<graph-root-id>"]
}
```

Candidate direct children:

```json
{
  "kinds": [31971],
  "#a": ["31971:<parent-owner>:<parent-id>"]
}
```

Candidate successors of a revision:

```json
{
  "kinds": [31971],
  "#e": ["<revision-id>"]
}
```

Comments, claims, and solutions:

```json
{
  "kinds": [1111],
  "#A": ["31971:<owner>:<problem-id>"]
}
```

Clients MUST inspect complete tags after filtering.

## Relay Behavior

Kind `31971` is addressable by:

```text
kind + pubkey + d
```

Owner and maintainer revisions have separate relay-level addresses.

Clients group revisions by matching:

```text
d + origin coordinate + genesis ID
```

Relays may discard older revisions from the same author. Complete history may require archival relays.
