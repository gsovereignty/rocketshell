import { describe, expect, it } from "vitest";
import type { NostrEvent, RelayEventResult } from "@napplet/sdk";
import { CHILD_CONVENTION, buildProblemTemplate, createProblemId, isChildPayload, resolveParent } from "./problem";

const hex = (char: string) => char.repeat(64);
const result = (event: Partial<NostrEvent> & Pick<NostrEvent, "id" | "pubkey" | "tags">): RelayEventResult => ({
  event: { kind: 31971, created_at: 1, content: "body", sig: hex("f"), ...event },
  sidecar: { relayHints: ["wss://relay.example"] }
});

describe("problem events", () => {
  it("uses the advertised problem-child convention", () => {
    expect(CHILD_CONVENTION).toBe("napplet:composer/problem-child");
  });

  it("generates a lowercase 32-byte id", () => {
    expect(createProblemId(new Uint8Array(32).fill(171))).toBe("ab".repeat(32));
  });

  it("validates exact child intent payloads", () => {
    expect(isChildPayload({ problemId: hex("a") })).toBe(true);
    expect(isChildPayload({ problemId: hex("a"), owner: hex("b") })).toBe(false);
    expect(isChildPayload({ problemId: "no" })).toBe(false);
  });

  it("builds graph-root genesis tags", () => {
    const pubkey = hex("a");
    const id = hex("b");
    const template = buildProblemTemplate(pubkey, id, {
      title: "Broken thing", description: "Complete description", status: "open", maintainers: []
    }, 10);
    expect(template.tags).toContainEqual(["a", `31971:${pubkey}:${id}`, "", "origin"]);
    expect(template.tags).toContainEqual(["A", `31971:${pubkey}:${id}`, ""]);
    expect(template.tags.some((item) => item[0] === "E")).toBe(false);
  });

  it("resolves a root parent and builds child graph tags", () => {
    const owner = hex("a");
    const parentId = hex("b");
    const parentEventId = hex("c");
    const parent = resolveParent(parentId, [result({
      id: parentEventId, pubkey: owner,
      tags: [["d", parentId], ["title", "Parent"], ["a", `31971:${owner}:${parentId}`, "", "origin"],
        ["A", `31971:${owner}:${parentId}`, ""], ["K", "31971"], ["P", owner, ""]]
    })]);
    const template = buildProblemTemplate(hex("d"), hex("e"), {
      title: "Child", description: "Details", status: "open", maintainers: []
    }, 10, parent);
    expect(template.tags).toContainEqual(["E", parentEventId, "wss://relay.example", owner]);
    expect(template.tags).toContainEqual(["e", parentEventId, "wss://relay.example", owner]);
  });

  it("rejects forked parent heads", () => {
    const owner = hex("a");
    const problemId = hex("b");
    const tags = [["d", problemId], ["a", `31971:${owner}:${problemId}`, "", "origin"]];
    expect(() => resolveParent(problemId, [
      result({ id: hex("c"), pubkey: owner, tags }), result({ id: hex("d"), pubkey: owner, tags })
    ])).toThrow("multiple current heads");
  });
});
