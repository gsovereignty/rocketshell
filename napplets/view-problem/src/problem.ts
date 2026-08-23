import type { EventTemplate, NostrEvent, RelayEventResult } from "@napplet/sdk";

export const PROBLEM_KIND = 31971;
export const COMMENT_KIND = 1111;
export const HEX_64 = /^[0-9a-f]{64}$/;
export const CLAIM_WINDOW_SECONDS = 86_400;

export interface ProblemView {
  coordinate: string;
  rootCoordinate: string;
  problemId: string;
  owner: string;
  revisionId: string;
  revisionAuthor: string;
  revisionCreatedAt: number;
  relay: string;
  title: string;
  description: string;
  status: string;
  maintainers: string[];
  parentOwners: string[];
  claim?: { eventId: string; claimant: string };
}

export interface ProblemRevision {
  id: string;
  author: string;
  createdAt: number;
  title: string;
  description: string;
  status: string;
  maintainers: string[];
  previousIds: string[];
}

export interface ProblemRevisionChange {
  field: "Title" | "Description" | "Status" | "Maintainers";
  before?: string;
  after: string;
}

export const problemRevisionAuthors = (problem: Pick<ProblemView, "owner" | "maintainers" | "parentOwners">): string[] =>
  [...new Set([problem.owner, ...problem.maintainers, ...problem.parentOwners])];

export interface EffectiveClaim {
  eventId: string;
  claimant: string;
  claimedAt?: number;
  expiresAt?: number;
  acknowledged: boolean;
}

const tag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));

const tagValue = (event: NostrEvent, name: string, marker?: string) => tag(event, name, marker)?.[1];

export function parseCoordinate(value: string) {
  const match = /^31971:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(value.trim());
  if (!match) throw new Error("Enter a valid 31971:owner:problem-id coordinate.");
  return { coordinate: value.trim(), owner: match[1], problemId: match[2] };
}

export function coordinateFromProblemEvent(event: NostrEvent) {
  if (event.kind !== PROBLEM_KIND || !HEX_64.test(event.id)) throw new Error("Selected event is not a valid problem revision.");
  const coordinate = tagValue(event, "a", "origin");
  if (!coordinate) throw new Error("Selected problem revision has no origin coordinate.");
  return parseCoordinate(coordinate).coordinate;
}

export function selectProblem(coordinate: string, results: RelayEventResult[]): ProblemView {
  const { owner, problemId } = parseCoordinate(coordinate);
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    tagValue(event, "d") === problemId && tagValue(event, "a", "origin") === coordinate);
  if (!candidates.length) throw new Error("Problem was not found.");
  const previous = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const heads = candidates.filter(({ event }) => !previous.has(event.id));
  if (heads.length !== 1) throw new Error("Problem has multiple current heads. Merge revisions before viewing it here.");
  const selected = heads[0];
  const claim = tag(selected.event, "claim");
  return {
    coordinate, rootCoordinate: tagValue(selected.event, "A") ?? coordinate, owner, problemId, revisionId: selected.event.id,
    revisionAuthor: selected.event.pubkey,
    revisionCreatedAt: selected.event.created_at,
    relay: selected.sidecar?.relayHints?.[0] ?? tag(selected.event, "a", "origin")?.[2] ?? "",
    title: tagValue(selected.event, "title") ?? "Untitled problem",
    description: selected.event.content,
    status: tagValue(selected.event, "status") ?? "open",
    maintainers: selected.event.tags
      .filter((item) => item[0] === "p" && item[3] === "maintainer" && HEX_64.test(item[1] ?? ""))
      .map((item) => item[1]),
    parentOwners: selected.event.tags
      .filter((item) => item[0] === "p" && item[3] === undefined && HEX_64.test(item[1] ?? ""))
      .map((item) => item[1]),
    claim: claim?.[1] && claim[2] ? { eventId: claim[1], claimant: claim[2] } : undefined
  };
}

export function problemRevisionHistory(coordinate: string, results: RelayEventResult[]): ProblemRevision[] {
  const { problemId } = parseCoordinate(coordinate);
  return results
    .map(({ event }) => event)
    .filter((event) => event.kind === PROBLEM_KIND &&
      tagValue(event, "d") === problemId && tagValue(event, "a", "origin") === coordinate)
    .map((event) => ({
      id: event.id,
      author: event.pubkey,
      createdAt: event.created_at,
      title: tagValue(event, "title") ?? "Untitled problem",
      description: event.content,
      status: tagValue(event, "status") ?? "open",
      maintainers: event.tags
        .filter((item) => item[0] === "p" && item[3] === "maintainer" && HEX_64.test(item[1] ?? ""))
        .map((item) => item[1]).sort(),
      previousIds: event.tags
        .filter((item) => item[0] === "e" && item[3] === "previous" && HEX_64.test(item[1] ?? ""))
        .map((item) => item[1])
    }))
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function problemEdits(revisions: ProblemRevision[]): ProblemRevision[] {
  const loadedIds = new Set(revisions.map(({ id }) => id));
  return revisions.filter(({ previousIds }) => previousIds.some((id) => loadedIds.has(id)));
}

export function compareProblemRevisions(previous: ProblemRevision | undefined, current: ProblemRevision): ProblemRevisionChange[] {
  const fields = [
    ["Title", previous?.title, current.title],
    ["Description", previous?.description, current.description],
    ["Status", previous?.status, current.status],
    ["Maintainers", previous?.maintainers.join(", "), current.maintainers.join(", ")]
  ] as const;
  return fields
    .filter(([, before, after]) => previous === undefined || before !== after)
    .map(([field, before, after]) => ({ field, ...(previous === undefined ? {} : { before }), after }));
}

export function mayEditProblem(problem: ProblemView, currentPubkey: string, ancestorOwners = problem.parentOwners) {
  return HEX_64.test(currentPubkey) &&
    (currentPubkey === problem.owner || problem.maintainers.includes(currentPubkey) || ancestorOwners.includes(currentPubkey));
}

const currentProblemHead = (coordinate: string, results: RelayEventResult[]): RelayEventResult => {
  const problemId = coordinate.split(":")[2] ?? "";
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    tagValue(event, "d") === problemId && tagValue(event, "a", "origin") === coordinate);
  if (!candidates.length) throw new Error(`Ancestor problem ${problemId} was not found.`);
  const previous = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const heads = candidates.filter(({ event }) => !previous.has(event.id));
  if (heads.length !== 1) throw new Error(`Ancestor problem ${problemId} has unresolved revision forks.`);
  return heads[0];
};

export function resolveProblemAncestorOwners(problem: ProblemView, results: RelayEventResult[]): string[] {
  const owners = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const selected = currentProblemHead(problem.coordinate, results).event;
  const visit = (coordinate: string) => {
    if (visiting.has(coordinate)) throw new Error("Problem ancestry contains a cycle.");
    if (visited.has(coordinate)) return;
    visiting.add(coordinate);
    const owner = coordinate.split(":")[1] ?? "";
    if (!HEX_64.test(owner)) throw new Error("Ancestor problem owner is invalid.");
    const head = currentProblemHead(coordinate, results).event;
    owners.add(owner);
    for (const parent of head.tags
      .filter((item) => item[0] === "a" && item[3] === undefined && /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(item[1] ?? ""))
      .map((item) => item[1])) visit(parent);
    visiting.delete(coordinate);
    visited.add(coordinate);
  };
  for (const parent of selected.tags
    .filter((item) => item[0] === "a" && item[3] === undefined && /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(item[1] ?? ""))
    .map((item) => item[1])) visit(parent);
  return [...owners].sort();
}

export function buildWorkflowTemplate(problem: ProblemView, content: string, action?: "claim"): EventTemplate {
  const tags = [
    ["A", problem.coordinate, problem.relay], ["K", String(PROBLEM_KIND)], ["P", problem.owner, problem.relay],
    ["a", problem.coordinate, problem.relay],
    ["e", problem.revisionId, problem.relay, problem.revisionAuthor],
    ["k", String(PROBLEM_KIND)], ["p", problem.revisionAuthor, problem.relay]
  ];
  if (action) tags.push([action]);
  return { kind: COMMENT_KIND, content: content.trim(), tags, created_at: Math.floor(Date.now() / 1000) };
}

export function hasClaimRequest(problem: ProblemView, results: RelayEventResult[], claimant?: string) {
  return results.some(({ event }) => event.kind === COMMENT_KIND &&
    (!claimant || event.pubkey === claimant) &&
    event.tags.some((item) => item[0] === "claim") &&
    event.tags.some((item) => item[0] === "A" && item[1] === problem.coordinate) &&
    event.tags.some((item) => item[0] === "e" && item[1] === problem.revisionId));
}

export function selectEffectiveClaim(
  problem: ProblemView,
  results: RelayEventResult[],
  revisions: ProblemRevision[]
): EffectiveClaim | undefined {
  if (problem.status === "claimed" && problem.claim) {
    const claimEvent = results.find(({ event }) => event.id === problem.claim?.eventId)?.event;
    return {
      eventId: problem.claim.eventId,
      claimant: problem.claim.claimant,
      claimedAt: claimEvent?.created_at,
      expiresAt: claimEvent ? claimEvent.created_at + CLAIM_WINDOW_SECONDS : undefined,
      acknowledged: true
    };
  }
  if (problem.status !== "open") return undefined;
  const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
  const claimTargetIsActive = (targetId: string) => {
    const targetStatusIsOpen = () => revisionsById.get(targetId)?.status === "open" || !revisionsById.has(targetId);
    if (targetId === problem.revisionId) return targetStatusIsOpen();
    const current = revisionsById.get(problem.revisionId);
    if (!current || current.status !== "open") return false;
    const pending = [...current.previousIds];
    const visited = new Set([problem.revisionId]);
    while (pending.length) {
      const revisionId = pending.pop()!;
      if (revisionId === targetId) return targetStatusIsOpen();
      if (visited.has(revisionId)) continue;
      visited.add(revisionId);
      const revision = revisionsById.get(revisionId);
      if (!revision || revision.status !== "open") continue;
      pending.push(...revision.previousIds);
    }
    return false;
  };
  const candidates = results.map(({ event }) => event).filter((event) =>
    event.kind === COMMENT_KIND && (() => {
      const coordinates = event.tags.filter((item) => item[0] === "A");
      const references = event.tags.filter((item) => item[0] === "a");
      const targets = event.tags.filter((item) => item[0] === "e");
      const claims = event.tags.filter((item) => item[0] === "claim");
      return coordinates.length === 1 && coordinates[0][1] === problem.coordinate &&
        references.length === 1 && references[0][1] === problem.coordinate &&
        claims.length === 1 && claims[0].length === 1 &&
        targets.length === 1 && HEX_64.test(targets[0][1] ?? "") && claimTargetIsActive(targets[0][1]);
    })());
  candidates.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  const selected = candidates[0];
  return selected ? {
    eventId: selected.id,
    claimant: selected.pubkey,
    claimedAt: selected.created_at,
    expiresAt: selected.created_at + CLAIM_WINDOW_SECONDS,
    acknowledged: false
  } : undefined;
}

export function formatClaimCountdown(remainingSeconds: number) {
  const remaining = Math.max(0, Math.ceil(remainingSeconds));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function relatedCoordinates(problem: ProblemView, results: RelayEventResult[]) {
  const coordinates = new Set<string>();
  for (const { event } of results) {
    for (const item of event.tags) {
      if ((item[0] === "a" || item[0] === "A" || item[0] === "q") &&
          /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(item[1] ?? "") && item[1] !== problem.coordinate) {
        coordinates.add(item[1]);
      }
    }
  }
  return Array.from(coordinates);
}

export function hasProblemChildren(coordinate: string, results: RelayEventResult[]): boolean {
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    HEX_64.test(event.id) && tag(event, "a", "origin")?.[1]?.match(/^31971:[0-9a-f]{64}:[0-9a-f]{64}$/));
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  return candidates.some(({ event }) => !referenced.has(event.id) &&
    event.tags.some((item) => item[0] === "a" && item[3] === undefined && item[1] === coordinate));
}

export const shortKey = (value: string) => `${value.slice(0, 8)}…${value.slice(-5)}`;
