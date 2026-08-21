import { describe, expect, it } from "vitest";
import type { NostrEvent, RelayEventResult } from "@napplet/sdk";
import { EDIT_CONVENTION, buildRevisionTemplate, isEditPayload, selectEditableProblem } from "./problem";

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

  it("builds full revision lineage and preserves graph tags", () => {
    const problem = selectEditableProblem(problemId, [result(event(hex("c")))], owner);
    const template = buildRevisionTemplate(problem, { title: "New title", description: "New body", status: "big", childStatus: "open" }, 20);
    expect(template.tags).toContainEqual(["e", hex("c"), "wss://relay.example", "genesis", owner]);
    expect(template.tags).toContainEqual(["e", hex("c"), "wss://relay.example", "previous", owner]);
    expect(template.tags).toContainEqual(["A", `31971:${owner}:${problemId}`, "wss://relay.example"]);
    expect(template.tags).toContainEqual(["child_status", "open"]);
  });

  it("rejects forked heads", () => {
    expect(() => selectEditableProblem(problemId, [result(event(hex("c"))), result(event(hex("d")))], owner)).toThrow("multiple current heads");
  });
});
