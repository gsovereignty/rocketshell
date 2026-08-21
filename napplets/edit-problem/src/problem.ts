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
  mayEdit: boolean;
}

const tag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));
const tagValue = (event: NostrEvent, name: string, marker?: string) => tag(event, name, marker)?.[1];

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
    /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/.test(tagValue(event, "a", "origin") ?? ""));
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
  const maintainers = selected.event.tags.filter((item) => item[0] === "p" && item[3] === "maintainer").map((item) => item[1]);
  const childStatus = tagValue(selected.event, "child_status");
  return {
    event: selected.event,
    relay: selected.sidecar?.relayHints?.[0] ?? tag(selected.event, "a", "origin")?.[2] ?? "",
    problemId,
    owner,
    title: tagValue(selected.event, "title") ?? "",
    description: selected.event.content,
    status: status as ProblemStatus,
    childStatus: childStatus === "rfm" || childStatus === "open" ? childStatus : undefined,
    mayEdit: pubkey === owner || maintainers.includes(pubkey)
  };
}

export function buildRevisionTemplate(
  problem: EditableProblem,
  update: { title: string; description: string; status: ProblemStatus; childStatus?: "rfm" | "open" },
  createdAt: number
): EventTemplate {
  const title = update.title.trim();
  const description = update.description.trim();
  if (!title) throw new Error("Title is required.");
  if (!description) throw new Error("Problem description is required.");
  if (!STATUSES.includes(update.status)) throw new Error("Problem status is invalid.");

  const lineageNames = new Set(["title", "status", "child_status"]);
  const tags = problem.event.tags.filter((item) =>
    !lineageNames.has(item[0]) && !(item[0] === "e" && (item[3] === "genesis" || item[3] === "previous")));
  const genesis = tagValue(problem.event, "e", "genesis") ?? problem.event.id;
  tags.splice(1, 0, ["title", title], ["status", update.status]);
  if (update.childStatus) tags.push(["child_status", update.childStatus]);
  tags.push(
    ["e", genesis, problem.relay, "genesis", problem.owner],
    ["e", problem.event.id, problem.relay, "previous", problem.event.pubkey]
  );
  return { kind: PROBLEM_KIND, content: description, tags, created_at: createdAt };
}
