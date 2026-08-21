import type { EventTemplate, NostrEvent, RelayEventResult } from "@napplet/sdk";

export const PROBLEM_KIND = 31971;
export const COMMENT_KIND = 1111;
export const HEX_64 = /^[0-9a-f]{64}$/;

export interface ProblemView {
  coordinate: string;
  problemId: string;
  owner: string;
  revisionId: string;
  revisionAuthor: string;
  relay: string;
  title: string;
  description: string;
  status: string;
  claim?: { eventId: string; claimant: string; height?: string };
}

const tag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));

const tagValue = (event: NostrEvent, name: string, marker?: string) => tag(event, name, marker)?.[1];

export function parseCoordinate(value: string) {
  const match = /^31971:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(value.trim());
  if (!match) throw new Error("Enter a valid 31971:owner:problem-id coordinate.");
  return { coordinate: value.trim(), owner: match[1], problemId: match[2] };
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
    coordinate, owner, problemId, revisionId: selected.event.id,
    revisionAuthor: selected.event.pubkey,
    relay: selected.sidecar?.relayHints?.[0] ?? tag(selected.event, "a", "origin")?.[2] ?? "",
    title: tagValue(selected.event, "title") ?? "Untitled problem",
    description: selected.event.content,
    status: tagValue(selected.event, "status") ?? "open",
    claim: claim?.[1] && claim[2] ? { eventId: claim[1], claimant: claim[2], height: claim[3] } : undefined
  };
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

export const shortKey = (value: string) => `${value.slice(0, 8)}…${value.slice(-5)}`;
