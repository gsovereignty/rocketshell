import type { EventTemplate, NostrEvent, RelayEventResult } from "@napplet/sdk";

export const PROBLEM_KIND = 31971;
export const CHILD_CONVENTION = "napplet:composer/problem-child";
export const HEX_64 = /^[0-9a-f]{64}$/;

export type ProblemStatus = "draft" | "rfm" | "big" | "children" | "open" | "closed";

export interface ParentContext {
  problemId: string;
  title: string;
  owner: string;
  revisionAuthor: string;
  revisionId: string;
  genesisId: string;
  relay: string;
  rootCoordinate: string;
  rootGenesisId: string;
  rootOwner: string;
  rootRelay: string;
  ancestorOwners: string[];
  defaultChildStatus: "rfm" | "open";
}

export interface ProblemDraft {
  title: string;
  description: string;
  status: ProblemStatus;
  childStatus?: "rfm" | "open";
  maintainers: string[];
  rocket?: { owner: string; id: string; relay: string };
  repository?: { owner: string; id: string; relay: string };
  bitcoin?: { height: string; hash: string };
}

export function normalizeProblemText(title: string, description: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("Add a problem title.");
  return { title: normalizedTitle, description: description.trim() };
}

const tag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));

const tagValue = (event: NostrEvent, name: string, marker?: string) => tag(event, name, marker)?.[1];

const selectCurrentHead = (candidates: RelayEventResult[]): RelayEventResult | undefined => {
  const referenced = new Set(candidates.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const eligible = candidates.filter(({ event }) => {
    if (referenced.has(event.id)) return false;
    const owner = tagValue(event, "a", "origin")?.split(":")[1] ?? "";
    return event.pubkey === owner || event.tags.some((item) =>
      item[0] === "p" && item[1] === event.pubkey && (item[3] === "maintainer" || item[3] === undefined));
  });
  if (!eligible.length) return undefined;
  const newestTimestamp = Math.max(...eligible.map(({ event }) => event.created_at));
  const newest = eligible.filter(({ event }) => event.created_at === newestTimestamp);
  return newest.length === 1 ? newest[0] : undefined;
};

const relayHint = (result: RelayEventResult) =>
  result.sidecar?.relayHints?.[0] ??
  result.event.tags.find((item) => item.length > 2 && item[2]?.startsWith("wss://"))?.[2] ?? "";

export function isChildPayload(payload: unknown): payload is { problemId: string } {
  if (typeof payload !== "object" || payload === null) return false;
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "problemId" &&
    typeof (payload as { problemId?: unknown }).problemId === "string" &&
    HEX_64.test((payload as { problemId: string }).problemId);
}

export function resolveParent(problemId: string, results: RelayEventResult[]): ParentContext {
  const candidates = results.filter(({ event }) =>
    event.kind === PROBLEM_KIND && tagValue(event, "d") === problemId && HEX_64.test(event.id));
  if (!candidates.length) throw new Error("Parent problem was not found.");

  const selected = selectCurrentHead(candidates);
  if (!selected) throw new Error("Parent has unresolved current heads.");
  const event = selected.event;
  const origin = tag(event, "a", "origin");
  if (!origin || !origin[1]?.startsWith(`${PROBLEM_KIND}:`)) throw new Error("Parent has no valid origin tag.");
  const [, owner = ""] = origin[1].split(":");
  if (!HEX_64.test(owner)) throw new Error("Parent owner is invalid.");

  const genesisId = tagValue(event, "e", "genesis") ?? event.id;
  const rootCoordinate = tagValue(event, "A") ?? origin[1];
  const [, rootOwner = ""] = rootCoordinate.split(":");
  const rootGenesisId = tagValue(event, "E") ?? genesisId;
  const rootOwnerTag = tagValue(event, "P") ?? rootOwner;
  if (!HEX_64.test(genesisId) || !HEX_64.test(rootGenesisId) || !HEX_64.test(rootOwnerTag)) {
    throw new Error("Parent graph-root references are invalid.");
  }

  const ancestorOwners = resolveAncestorOwners(event, results);

  return {
    problemId,
    title: tagValue(event, "title") ?? "Untitled parent",
    owner,
    revisionAuthor: event.pubkey,
    revisionId: event.id,
    genesisId,
    relay: relayHint(selected),
    rootCoordinate,
    rootGenesisId,
    rootOwner: rootOwnerTag,
    rootRelay: tag(event, "A")?.[2] || relayHint(selected),
    ancestorOwners: [owner, ...ancestorOwners.filter((ancestor) => ancestor !== owner)],
    defaultChildStatus: tagValue(event, "child_status") === "rfm" ? "rfm" : "open"
  };
}

const currentHead = (coordinate: string, results: RelayEventResult[]): RelayEventResult => {
  const problemId = coordinate.split(":")[2] ?? "";
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND &&
    tagValue(event, "d") === problemId && tagValue(event, "a", "origin") === coordinate);
  if (!candidates.length) throw new Error(`Ancestor problem ${problemId} was not found.`);
  const selected = selectCurrentHead(candidates);
  if (!selected) throw new Error(`Ancestor problem ${problemId} has unresolved revision forks.`);
  return selected;
};

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
    for (const parent of head.tags
      .filter((item) => item[0] === "a" && item[3] === undefined && /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(item[1] ?? ""))
      .map((item) => item[1])) visit(parent);
    visiting.delete(coordinate);
    visited.add(coordinate);
  };
  for (const parent of event.tags
    .filter((item) => item[0] === "a" && item[3] === undefined && /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(item[1] ?? ""))
    .map((item) => item[1])) visit(parent);
  return [...owners].sort();
}

export function parentGraphRoot(problemId: string, results: RelayEventResult[]): string {
  const candidates = results.filter(({ event }) => event.kind === PROBLEM_KIND && tagValue(event, "d") === problemId);
  if (!candidates.length) throw new Error("Parent problem was not found.");
  const selected = selectCurrentHead(candidates);
  if (!selected) throw new Error("Parent has unresolved current heads.");
  const root = tagValue(selected.event, "A");
  if (!/^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(root ?? "")) throw new Error("Parent graph root is invalid.");
  return root!;
}

export function createProblemId(random: Uint8Array): string {
  if (random.length !== 32) throw new Error("Problem IDs require 32 random bytes.");
  return Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildProblemTemplate(
  pubkey: string,
  problemId: string,
  draft: ProblemDraft,
  createdAt: number,
  parent?: ParentContext
): EventTemplate {
  if (!HEX_64.test(pubkey) || !HEX_64.test(problemId)) throw new Error("Problem identity is invalid.");
  const coordinate = `${PROBLEM_KIND}:${pubkey}:${problemId}`;
  const tags: string[][] = [
    ["d", problemId],
    ["title", draft.title.trim()],
    ["status", draft.status],
    ["a", coordinate, "", "origin"]
  ];

  if (parent) {
    tags.push(
      ["A", parent.rootCoordinate, parent.rootRelay],
      ["E", parent.rootGenesisId, parent.rootRelay, parent.rootOwner],
      ["K", String(PROBLEM_KIND)],
      ["P", parent.rootOwner, parent.rootRelay],
      ["a", `${PROBLEM_KIND}:${parent.owner}:${parent.problemId}`, parent.relay],
      ["e", parent.genesisId, parent.relay, parent.owner],
      ["k", String(PROBLEM_KIND)],
      ["p", parent.owner, parent.relay]
    );
  } else {
    tags.push(
      ["A", coordinate, ""],
      ["K", String(PROBLEM_KIND)],
      ["P", pubkey, ""]
    );
  }

  const requiredMaintainers = new Set([pubkey, ...(parent?.ancestorOwners ?? []), ...draft.maintainers]);
  for (const maintainer of requiredMaintainers) tags.push(["p", maintainer, "", "maintainer"]);
  if (draft.childStatus) tags.push(["child_status", draft.childStatus]);
  if (draft.rocket) tags.push(["a", `31108:${draft.rocket.owner}:${draft.rocket.id}`, draft.rocket.relay, "rocket"]);
  if (draft.repository) tags.push(["a", `30617:${draft.repository.owner}:${draft.repository.id}`, draft.repository.relay, "repository"]);
  if (draft.bitcoin) tags.push(["bitcoin", draft.bitcoin.height, draft.bitcoin.hash]);

  return { kind: PROBLEM_KIND, content: draft.description.trim(), tags, created_at: createdAt };
}
