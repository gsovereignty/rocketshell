import { describe, expect, it } from "vitest";
import type { NostrEvent, RelayEventResult } from "@napplet/sdk";
import { EDIT_CONVENTION, buildRevisionTemplate, hasProblemChildren, isEditPayload, selectEditableProblem } from "./problem";

const hex = (char: string) => char.repeat(64);
const owner = hex("a");
const problemId = hex("b");
const event = (id: string, pubkey = owner, extra: string[][] = []): NostrEvent => ({
  id, pubkey, kind: 31971, created_at: 10, content: "Old body", sig: hex("f"),
  tags: [["d", problemId], ["title", "Old title"], ["status", "open"],
    ["a", `31971:${owner}:${problemId}`, "wss://relay.example", "origin"],
    ["A", `31971:${owner}:${problemId}`, "wss://relay.example"], ["K", "31971"], ["P", owner, "wss://relay.example"], ...extra]
});
const result = (nostrEvent: NostrEvent): RelayEventResult => ({ event: nostrEvent, sidecar: { relayHints: ["wss://relay.example"] } });

describe("problem editor", () => {
  it("uses stable composer edit convention", () => expect(EDIT_CONVENTION).toBe("napplet:composer/problem-edit"));

  it("accepts only exact problem-id payload", () => {
    expect(isEditPayload({ problemId })).toBe(true);
    expect(isEditPayload({ problemId, owner })).toBe(false);
    expect(isEditPayload({ problemId: "bad" })).toBe(false);
  });

  it("selects only head and grants listed maintainer", () => {
    const genesis = event(hex("c"), owner, [["p", hex("d"), "", "maintainer"]]);
    const revision = event(hex("e"), hex("d"), [["p", hex("d"), "", "maintainer"], ["e", genesis.id, "", "genesis", owner], ["e", genesis.id, "", "previous", owner]]);
    expect(selectEditableProblem(problemId, [result(genesis), result(revision)], hex("d")).event.id).toBe(revision.id);
  });

  it("grants direct parent owner maintainer permissions", () => {
    const parentOwner = hex("d");
    const child = event(hex("c"), owner, [["p", parentOwner, "wss://parent.example"]]);
    expect(selectEditableProblem(problemId, [result(child)], parentOwner).mayEdit).toBe(true);
    expect(selectEditableProblem(problemId, [result(child)], hex("e")).mayEdit).toBe(false);
  });

  it("builds full revision lineage and preserves graph tags", () => {
    const problem = selectEditableProblem(problemId, [result(event(hex("c")))], owner);
    const template = buildRevisionTemplate(problem, { title: "New title", description: "New body", status: "big", childStatus: "open" }, 20);
    expect(template.tags).toContainEqual(["e", hex("c"), "wss://relay.example", "genesis", owner]);
    expect(template.tags).toContainEqual(["e", hex("c"), "wss://relay.example", "previous", owner]);
    expect(template.tags).toContainEqual(["A", `31971:${owner}:${problemId}`, "wss://relay.example"]);
    expect(template.tags).toContainEqual(["child_status", "open"]);
  });

  it("adds owner and direct parent owners as maintainers on owner edit", () => {
    const parentOwner = hex("d");
    const existingMaintainer = hex("e");
    const problem = selectEditableProblem(problemId, [result(event(hex("c"), owner, [
      ["p", parentOwner, "wss://parent.example"],
      ["p", existingMaintainer, "", "maintainer"]
    ]))], owner);
    const template = buildRevisionTemplate(problem, { title: "New title", description: "New body", status: "open" }, 20);
    expect(template.tags).toContainEqual(["p", owner, "", "maintainer"]);
    expect(template.tags).toContainEqual(["p", parentOwner, "", "maintainer"]);
    expect(template.tags).toContainEqual(["p", existingMaintainer, "", "maintainer"]);
    expect(template.tags.filter((item) => item[0] === "p" && item[1] === parentOwner && item[3] === "maintainer")).toHaveLength(1);
  });

  it("preserves maintainer list unchanged on non-owner edit", () => {
    const parentOwner = hex("d");
    const problem = selectEditableProblem(problemId, [result(event(hex("c"), owner, [
      ["p", parentOwner, "wss://parent.example"]
    ]))], parentOwner);
    const template = buildRevisionTemplate(problem, { title: "New title", description: "New body", status: "open" }, 20);
    expect(template.tags).not.toContainEqual(["p", owner, "", "maintainer"]);
    expect(template.tags).not.toContainEqual(["p", parentOwner, "", "maintainer"]);
  });

  it("rejects forked heads", () => {
    expect(() => selectEditableProblem(problemId, [result(event(hex("c"))), result(event(hex("d")))], owner)).toThrow("multiple current heads");
  });

  it("forces owner edits to children when current children exist", () => {
    const problem = selectEditableProblem(problemId, [result(event(hex("c")))], owner);
    const template = buildRevisionTemplate(problem, { title: "New title", description: "New body", status: "open" }, 20, true);
    expect(template.tags).toContainEqual(["status", "children"]);
    expect(template.tags).not.toContainEqual(["status", "open"]);
  });

  it("does not override maintainer-selected status", () => {
    const maintainer = hex("d");
    const problem = selectEditableProblem(problemId, [result(event(hex("c"), owner, [["p", maintainer, "", "maintainer"]]))], maintainer);
    const template = buildRevisionTemplate(problem, { title: "New title", description: "New body", status: "open" }, 20, true);
    expect(template.tags).toContainEqual(["status", "open"]);
  });

  it("counts only current direct child heads", () => {
    const childId = hex("d");
    const childCoordinate = `31971:${hex("e")}:${childId}`;
    const child = (id: string, previous?: string, parent = `31971:${owner}:${problemId}`) => result({
      ...event(id, hex("e")), tags: [["d", childId], ["a", childCoordinate, "", "origin"], ["a", parent],
        ...(previous ? [["e", previous, "", "previous"]] : [])]
    });
    const genesis = child(hex("1"));
    expect(hasProblemChildren(`31971:${owner}:${problemId}`, [genesis])).toBe(true);
    expect(hasProblemChildren(`31971:${owner}:${problemId}`, [genesis, child(hex("2"), hex("1"), `31971:${owner}:${hex("0")}`)])).toBe(false);
  });
});
