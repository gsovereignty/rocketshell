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

const tag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));

const tagValue = (event: NostrEvent, name: string, marker?: string) => tag(event, name, marker)?.[1];

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

  const referenced = new Set(candidates.flatMap(({ event }) =>
    event.tags.filter((item) => item[0] === "e" && item[3] === "previous").map((item) => item[1])));
  const heads = candidates.filter(({ event }) => !referenced.has(event.id));
  if (heads.length !== 1) throw new Error("Parent has multiple current heads. Merge its revisions before adding a child.");

  const selected = heads[0];
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
    defaultChildStatus: tagValue(event, "child_status") === "rfm" ? "rfm" : "open"
  };
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

  for (const maintainer of draft.maintainers) tags.push(["p", maintainer, "", "maintainer"]);
  if (draft.childStatus) tags.push(["child_status", draft.childStatus]);
  if (draft.rocket) tags.push(["a", `31108:${draft.rocket.owner}:${draft.rocket.id}`, draft.rocket.relay, "rocket"]);
  if (draft.repository) tags.push(["a", `30617:${draft.repository.owner}:${draft.repository.id}`, draft.repository.relay, "repository"]);
  if (draft.bitcoin) tags.push(["bitcoin", draft.bitcoin.height, draft.bitcoin.hash]);

  return { kind: PROBLEM_KIND, content: draft.description.trim(), tags, created_at: createdAt };
}
