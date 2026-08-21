import { describe, expect, it } from "vitest";
import type { NostrEvent, RelayEventResult } from "@napplet/sdk";
import { ROOT_A_TAG, assertRootCoordinate, buildProblemDag, descendantsCount, leafDescendants } from "./problem-dag";

const hex = (char: string) => char.repeat(64);
const root = `31971:${hex("a")}:${hex("b")}`;
const child = `31971:${hex("c")}:${hex("d")}`;
const result = (event: Partial<NostrEvent> & Pick<NostrEvent, "id" | "pubkey" | "tags">): RelayEventResult => ({
  event: { kind: 31971, created_at: 1, content: "", sig: hex("f"), ...event },
  sidecar: { relayHints: [] }
});
const problem = (coordinate: string, id: string, extra: string[][] = [], created_at = 1) => result({
  id, pubkey: coordinate.split(":")[1], created_at,
  tags: [["d", coordinate.split(":")[2]], ["title", coordinate === root ? "Root" : "Child"],
    ["status", "open"], ["a", coordinate, "", "origin"], ["A", root, ""], ...extra]
});

describe("problem DAG", () => {
  it("uses the configured problem tree root", () => {
    expect(ROOT_A_TAG).toBe("31971:d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075:79358b35c722c94fd9ff49ec0fcc257081efe29bc38902fcf6e85d83c58633e4");
  });

  it("validates full kind 31971 coordinates", () => {
    expect(assertRootCoordinate(` ${root.toUpperCase()} `)).toBe(root);
    expect(() => assertRootCoordinate(hex("a"))).toThrow("Enter root as");
  });

  it("builds direct children and descendant totals", () => {
    const dag = buildProblemDag(root, [
      problem(root, hex("1")),
      problem(child, hex("2"), [["a", root, ""]])
    ]);
    expect(dag.children.get(root)).toEqual([child]);
    expect(descendantsCount(dag, root)).toBe(1);
  });

  it("keeps parent candidates from forked heads visible", () => {
    const otherParent = `31971:${hex("e")}:${hex("f")}`;
    const common = [["e", hex("3"), "", "genesis", hex("c")]];
    const dag = buildProblemDag(root, [
      problem(root, hex("1")), problem(otherParent, hex("2"), [["a", root, ""]]),
      problem(child, hex("4"), [...common, ["a", root, ""]], 3),
      problem(child, hex("5"), [...common, ["a", otherParent, ""]], 4)
    ]);
    expect(dag.nodes.get(child)?.forkCount).toBe(1);
    expect(dag.nodes.get(child)?.parentCoordinates).toEqual([root, otherParent].sort());
  });

  it("finds all leaf descendants recursively", () => {
    const grandchild = `31971:${hex("e")}:${hex("f")}`;
    const closedLeaf = `31971:${hex("6")}:${hex("7")}`;
    const dag = buildProblemDag(root, [
      problem(root, hex("1")),
      problem(child, hex("2"), [["a", root, ""]]),
      problem(grandchild, hex("3"), [["a", child, ""]]),
      result({
        id: hex("4"), pubkey: hex("6"),
        tags: [["d", hex("7")], ["title", "Closed leaf"], ["status", "closed"],
          ["a", closedLeaf, "", "origin"], ["A", root, ""], ["a", root, ""]]
      })
    ]);

    expect(leafDescendants(dag, root).map((node) => node.coordinate)).toEqual([grandchild, closedLeaf]);
    expect(leafDescendants(dag, child).map((node) => node.coordinate)).toEqual([grandchild]);
    expect(leafDescendants(dag, grandchild)).toEqual([]);
  });
});
