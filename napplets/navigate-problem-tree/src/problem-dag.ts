import type { NostrEvent, RelayEventResult } from "@napplet/sdk";

export const PROBLEM_KIND = 31971;
export const ROOT_A_TAG = "31971:d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075:79358b35c722c94fd9ff49ec0fcc257081efe29bc38902fcf6e85d83c58633e4";
export const COORDINATE = /^31971:([0-9a-f]{64}):([0-9a-f]{64})$/;

export type ProblemStatus = "draft" | "rfm" | "big" | "children" | "open" | "claimed" | "patched" | "closed";

export interface ProblemNode {
  coordinate: string;
  problemId: string;
  title: string;
  status: ProblemStatus;
  revisionId: string;
  revisionCount: number;
  forkCount: number;
  parentCoordinates: string[];
}

export interface ProblemDag {
  rootCoordinate: string;
  nodes: Map<string, ProblemNode>;
  children: Map<string, string[]>;
}

const findTag = (event: NostrEvent, name: string, marker?: string) =>
  event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));

const tagValue = (event: NostrEvent, name: string, marker?: string) => findTag(event, name, marker)?.[1];

const coordinateOf = (event: NostrEvent) => tagValue(event, "a", "origin") ?? "";

const statusOf = (event: NostrEvent): ProblemStatus => {
  const value = tagValue(event, "status");
  return ["draft", "rfm", "big", "children", "open", "claimed", "patched", "closed"].includes(value ?? "")
    ? value as ProblemStatus
    : "open";
};

const parentCoordinatesOf = (event: NostrEvent) => Array.from(new Set(
  event.tags
    .filter((item) => item[0] === "a" && item[3] !== "origin" && COORDINATE.test(item[1] ?? ""))
    .map((item) => item[1])
));

export function assertRootCoordinate(value: string): string {
  const coordinate = value.trim().toLowerCase();
  if (!COORDINATE.test(coordinate)) {
    throw new Error("Enter root as 31971:<64-character owner>:<64-character problem id>.");
  }
  return coordinate;
}

export function buildProblemDag(rootCoordinate: string, results: RelayEventResult[]): ProblemDag {
  const root = assertRootCoordinate(rootCoordinate);
  const uniqueEvents = new Map<string, NostrEvent>();
  for (const { event } of results) {
    if (event.kind === PROBLEM_KIND && event.id && tagValue(event, "A") === root) uniqueEvents.set(event.id, event);
  }

  const groups = new Map<string, NostrEvent[]>();
  for (const event of uniqueEvents.values()) {
    const coordinate = coordinateOf(event);
    if (!COORDINATE.test(coordinate)) continue;
    const group = groups.get(coordinate) ?? [];
    group.push(event);
    groups.set(coordinate, group);
  }
  if (!groups.has(root)) throw new Error("Root problem was not found in returned DAG events.");

  const nodes = new Map<string, ProblemNode>();
  for (const [coordinate, revisions] of groups) {
    const previous = new Set(revisions.flatMap((event) => event.tags
      .filter((item) => item[0] === "e" && item[3] === "previous")
      .map((item) => item[1])));
    const heads = revisions.filter((event) => !previous.has(event.id));
    const current = [...(heads.length ? heads : revisions)].sort((a, b) =>
      b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
    const allHeadParents = heads.flatMap(parentCoordinatesOf);
    const parentCoordinates = Array.from(new Set(allHeadParents.length ? allHeadParents : parentCoordinatesOf(current))).sort();
    nodes.set(coordinate, {
      coordinate,
      problemId: coordinate.split(":")[2],
      title: tagValue(current, "title")?.trim() || "Untitled problem",
      status: statusOf(current),
      revisionId: current.id,
      revisionCount: revisions.length,
      forkCount: Math.max(0, heads.length - 1),
      parentCoordinates
    });
  }

  const children = new Map<string, string[]>();
  for (const node of nodes.values()) {
    for (const parent of node.parentCoordinates) {
      if (!nodes.has(parent) || parent === node.coordinate) continue;
      const list = children.get(parent) ?? [];
      if (!list.includes(node.coordinate)) list.push(node.coordinate);
      children.set(parent, list);
    }
  }
  for (const list of children.values()) list.sort((a, b) => nodes.get(a)!.title.localeCompare(nodes.get(b)!.title));
  return { rootCoordinate: root, nodes, children };
}

export function descendantsCount(dag: ProblemDag, coordinate: string): number {
  const seen = new Set<string>();
  const visit = (parent: string) => {
    for (const child of dag.children.get(parent) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      visit(child);
    }
  };
  visit(coordinate);
  return seen.size;
}

export function leafDescendants(dag: ProblemDag, coordinate: string): ProblemNode[] {
  const leaves: ProblemNode[] = [];
  const seen = new Set<string>();
  const visit = (parent: string) => {
    for (const childCoordinate of dag.children.get(parent) ?? []) {
      if (seen.has(childCoordinate)) continue;
      seen.add(childCoordinate);
      const child = dag.nodes.get(childCoordinate);
      if (!child) continue;
      const children = dag.children.get(childCoordinate) ?? [];
      if (children.length) visit(childCoordinate);
      else leaves.push(child);
    }
  };
  visit(coordinate);
  return leaves.sort((a, b) => a.title.localeCompare(b.title));
}

export function statusLabel(status: ProblemStatus): string {
  return status === "rfm" ? "RFM" : status[0].toUpperCase() + status.slice(1);
}
