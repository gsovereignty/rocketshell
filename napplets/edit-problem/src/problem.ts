import type { EventTemplate, NostrEvent, RelayEventResult } from "@napplet/sdk";

export const PROBLEM_KIND = 31971;
export const EDIT_CONVENTION = "napplet:composer/problem-edit";
export const HEX_64 = /^[0-9a-f]{64}$/;
export const STATUSES = ["draft", "rfm", "big", "children", "open", "claimed", "patched", "closed"] as const;
export type ProblemStatus = typeof STATUSES[number];

export interface EditableProblem {
  event: NostrEvent;
  relay: string;
  problemId: string;
  owner: string;
  title: string;
  description: string;
  status: ProblemStatus;
  childStatus?: "rfm" | "open";
  parentCoordinates: string[];
  ancestorOwners: string[];
  mayEdit: boolean;
  isOwner: boolean;
}

export interface ResolvedParent {
  coordinate: string;
  owner: string;
  genesisId: string;
  relay: string;
}

export interface ResolvedParentChange {
  parents: ResolvedParent[];
  ancestorOwners: string[];
}

export interface ParentOption {
  coordinate: string;
  title: string;
}

const PROBLEM_COORDINATE = /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/;

const tag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));
const tagValue = (event: NostrEvent, name: string, marker?: string) => tag(event, name, marker)?.[1];

export function canEditProblem(problem: Pick<EditableProblem, "owner" | "ancestorOwners" | "event">, pubkey: string): boolean {
  if (!HEX_64.test(pubkey)) return false;
  const maintainers = problem.event.tags
    .filter((item) => item[0] === "p" && item[3] === "maintainer")
    .map((item) => item[1]);
  return pubkey === problem.owner || maintainers.includes(pubkey) || problem.ancestorOwners.includes(pubkey);
}

const currentHead = (coordinate: string, results: RelayEventResult[]): RelayEventResult => {
  const problemId = coordinate.split(":")[2] ?? "";
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    tagValue(event, "d") === problemId && tagValue(event, "a", "origin") === coordinate);
  if (!candidates.length) throw new Error(`Ancestor problem ${problemId} was not found.`);
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const heads = candidates.filter(({ event }) => !referenced.has(event.id));
  if (heads.length !== 1) throw new Error(`Ancestor problem ${problemId} has unresolved revision forks.`);
  return heads[0];
};

const directParentCoordinates = (event: NostrEvent): string[] => event.tags
  .filter((item) => item[0] === "a" && item[3] === undefined && PROBLEM_COORDINATE.test(item[1] ?? ""))
  .map((item) => item[1]);

const rootCoordinate = (event: NostrEvent): string => {
  const root = tagValue(event, "A") ?? "";
  if (!PROBLEM_COORDINATE.test(root)) throw new Error("Problem graph root is invalid.");
  return root;
};

export function selectableParentOptions(problem: EditableProblem, results: RelayEventResult[]): ParentOption[] {
  const ownCoordinate = `31971:${problem.owner}:${problem.problemId}`;
  const graphRoot = rootCoordinate(problem.event);
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    PROBLEM_COORDINATE.test(tagValue(event, "a", "origin") ?? "") &&
    tagValue(event, "A") === graphRoot);
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const headsByCoordinate = new Map<string, RelayEventResult[]>();
  for (const result of candidates.filter(({ event }) => !referenced.has(event.id))) {
    const coordinate = tagValue(result.event, "a", "origin")!;
    headsByCoordinate.set(coordinate, [...(headsByCoordinate.get(coordinate) ?? []), result]);
  }
  const uniqueHeads = new Map([...headsByCoordinate]
    .filter(([, heads]) => heads.length === 1)
    .map(([coordinate, heads]) => [coordinate, heads[0].event]));

  const descendants = new Set([ownCoordinate]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [coordinate, event] of uniqueHeads) {
      if (descendants.has(coordinate) || !directParentCoordinates(event).some((parent) => descendants.has(parent))) continue;
      descendants.add(coordinate);
      changed = true;
    }
  }

  return [...uniqueHeads]
    .filter(([coordinate]) => !descendants.has(coordinate))
    .map(([coordinate, event]) => ({ coordinate, title: tagValue(event, "title")?.trim() || "Untitled problem" }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.coordinate.localeCompare(right.coordinate));
}

export function resolveAncestorOwners(event: NostrEvent, results: RelayEventResult[]): string[] {
  const owners = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (coordinate: string) => {
    if (visiting.has(coordinate)) throw new Error("Problem ancestry contains a cycle.");
    if (visited.has(coordinate)) return;
    visiting.add(coordinate);
    const owner = coordinate.split(":")[1] ?? "";
    if (!HEX_64.test(owner)) throw new Error("Ancestor problem owner is invalid.");
    const head = currentHead(coordinate, results).event;
    owners.add(owner);
    for (const parent of directParentCoordinates(head)) visit(parent);
    visiting.delete(coordinate);
    visited.add(coordinate);
  };
  for (const parent of directParentCoordinates(event)) visit(parent);
  return [...owners].sort();
}

export function resolveParentChange(
  problem: EditableProblem,
  proposedCoordinates: string[],
  results: RelayEventResult[]
): ResolvedParentChange {
  if (!problem.mayEdit) throw new Error("Connected identity is not authorized to change direct parents.");
  const ownCoordinate = `31971:${problem.owner}:${problem.problemId}`;
  const graphRoot = rootCoordinate(problem.event);
  const isRoot = ownCoordinate === graphRoot;
  if (isRoot && proposedCoordinates.length) throw new Error("Graph root cannot have direct parents.");
  if (!isRoot && !proposedCoordinates.length) throw new Error("Non-root problem must have at least one direct parent.");

  const seen = new Set<string>();
  for (const coordinate of proposedCoordinates) {
    if (!PROBLEM_COORDINATE.test(coordinate)) throw new Error(`Parent coordinate is invalid: ${coordinate || "empty value"}.`);
    if (coordinate === ownCoordinate) throw new Error("Problem cannot be its own parent.");
    if (seen.has(coordinate)) throw new Error(`Direct parent is duplicated: ${coordinate}.`);
    seen.add(coordinate);
  }

  const parents: ResolvedParent[] = [];
  const ancestorOwners = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>([ownCoordinate]);
  const visit = (coordinate: string): RelayEventResult => {
    if (visiting.has(coordinate)) throw new Error("Proposed direct parents create a cycle.");
    const selected = currentHead(coordinate, results);
    if (rootCoordinate(selected.event) !== graphRoot) throw new Error(`Parent ${coordinate} belongs to a different problem graph.`);
    if (visited.has(coordinate)) return selected;
    visiting.add(coordinate);
    const owner = coordinate.split(":")[1] ?? "";
    if (!HEX_64.test(owner)) throw new Error(`Parent ${coordinate} has invalid owner.`);
    ancestorOwners.add(owner);
    for (const parent of directParentCoordinates(selected.event)) visit(parent);
    visiting.delete(coordinate);
    visited.add(coordinate);
    return selected;
  };

  for (const coordinate of proposedCoordinates) {
    const selected = visit(coordinate);
    const owner = coordinate.split(":")[1]!;
    const genesisId = tagValue(selected.event, "e", "genesis") ?? selected.event.id;
    if (!HEX_64.test(genesisId)) throw new Error(`Parent ${coordinate} has invalid genesis revision.`);
    parents.push({
      coordinate,
      owner,
      genesisId,
      relay: selected.sidecar?.relayHints?.[0] ?? tag(selected.event, "a", "origin")?.[2] ?? ""
    });
  }
  return { parents, ancestorOwners: [...ancestorOwners].sort() };
}

export function problemGraphRoot(problemId: string, results: RelayEventResult[]): string {
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND && tagValue(event, "d") === problemId);
  if (!candidates.length) throw new Error("Problem was not found.");
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const heads = candidates.filter(({ event }) => !referenced.has(event.id));
  if (heads.length !== 1) throw new Error("Problem has multiple current heads. Merge revisions before editing.");
  const root = tagValue(heads[0].event, "A");
  if (!PROBLEM_COORDINATE.test(root ?? "")) throw new Error("Problem graph root is invalid.");
  return root!;
}

export function isEditPayload(payload: unknown): payload is { problemId: string } {
  if (typeof payload !== "object" || payload === null) return false;
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "problemId" &&
    typeof (payload as { problemId?: unknown }).problemId === "string" &&
    HEX_64.test((payload as { problemId: string }).problemId);
}

export function selectEditableProblem(problemId: string, results: RelayEventResult[], pubkey: string): EditableProblem {
  if (!HEX_64.test(problemId)) throw new Error("Problem ID is invalid.");
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    event.id && HEX_64.test(event.id) && tagValue(event, "d") === problemId &&
    PROBLEM_COORDINATE.test(tagValue(event, "a", "origin") ?? ""));
  if (!candidates.length) throw new Error("Problem was not found.");
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const heads = candidates.filter(({ event }) => !referenced.has(event.id));
  if (heads.length !== 1) throw new Error("Problem has multiple current heads. Merge revisions before editing.");
  const selected = heads[0];
  const origin = tagValue(selected.event, "a", "origin") ?? "";
  const owner = origin.split(":")[1] ?? "";
  const status = tagValue(selected.event, "status") ?? "open";
  if (!HEX_64.test(owner) || !STATUSES.includes(status as ProblemStatus)) throw new Error("Problem state is invalid.");
  const childStatus = tagValue(selected.event, "child_status");
  const problem: EditableProblem = {
    event: selected.event,
    relay: selected.sidecar?.relayHints?.[0] ?? tag(selected.event, "a", "origin")?.[2] ?? "",
    problemId,
    owner,
    title: tagValue(selected.event, "title") ?? "",
    description: selected.event.content,
    status: status as ProblemStatus,
    childStatus: childStatus === "rfm" || childStatus === "open" ? childStatus : undefined,
    parentCoordinates: directParentCoordinates(selected.event),
    ancestorOwners: resolveAncestorOwners(selected.event, results),
    mayEdit: false,
    isOwner: pubkey === owner
  };
  problem.mayEdit = canEditProblem(problem, pubkey);
  return problem;
}

export function hasProblemChildren(coordinate: string, results: RelayEventResult[]): boolean {
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND && HEX_64.test(event.id) &&
    PROBLEM_COORDINATE.test(tagValue(event, "a", "origin") ?? ""));
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  return candidates.some(({ event }) => !referenced.has(event.id) &&
    event.tags.some((item) => item[0] === "a" && item[3] === undefined && item[1] === coordinate));
}

export function buildRevisionTemplate(
  problem: EditableProblem,
  update: { title: string; description: string; status: ProblemStatus; childStatus?: "rfm" | "open" },
  createdAt: number,
  hasChildren = false,
  parentChange?: ResolvedParentChange
): EventTemplate {
  const title = update.title.trim();
  const description = update.description.trim();
  if (!title) throw new Error("Title is required.");
  if (!description) throw new Error("Problem description is required.");
  if (!STATUSES.includes(update.status)) throw new Error("Problem status is invalid.");

  const lineageNames = new Set(["title", "status", "child_status"]);
  const tags = problem.event.tags.filter((item) =>
    !lineageNames.has(item[0]) &&
    !(item[0] === "e" && (item[3] === "genesis" || item[3] === "previous")) &&
    !(parentChange && (
      ((item[0] === "a" || item[0] === "p") && item[3] === undefined) ||
      (item[0] === "e" && item[3] !== "genesis" && item[3] !== "previous") ||
      item[0] === "k"
    )));
  if (parentChange) {
    for (const parent of parentChange.parents) {
      tags.push(["a", parent.coordinate, parent.relay], ["e", parent.genesisId, parent.relay, parent.owner]);
    }
    if (parentChange.parents.length) tags.push(["k", "31971"]);
    const parentOwners = new Map(parentChange.parents.map((parent) => [parent.owner, parent.relay]));
    for (const [owner, relay] of parentOwners) tags.push(["p", owner, relay]);
  }
  if (problem.isOwner) {
    const requiredMaintainers = new Set([problem.owner, ...(parentChange?.ancestorOwners ?? problem.ancestorOwners)]);
    const listedMaintainers = new Set(tags
      .filter((item) => item[0] === "p" && item[3] === "maintainer")
      .map((item) => item[1]));
    for (const maintainer of requiredMaintainers) {
      if (!listedMaintainers.has(maintainer)) tags.push(["p", maintainer, "", "maintainer"]);
    }
  }
  const genesis = tagValue(problem.event, "e", "genesis") ?? problem.event.id;
  const status = problem.isOwner && hasChildren ? "children" : update.status;
  tags.splice(1, 0, ["title", title], ["status", status]);
  if (update.childStatus) tags.push(["child_status", update.childStatus]);
  tags.push(
    ["e", genesis, problem.relay, "genesis", problem.owner],
    ["e", problem.event.id, problem.relay, "previous", problem.event.pubkey]
  );
  return { kind: PROBLEM_KIND, content: description, tags, created_at: createdAt };
}
