import { describe, expect, it } from "vitest";
import { buildWorkflowTemplate, parseCoordinate, relatedCoordinates, selectProblem } from "./problem";

const owner = "a".repeat(64);
const id = "b".repeat(64);
const revision = "c".repeat(64);
const coordinate = `31971:${owner}:${id}`;
const result = { event: { id: revision, pubkey: owner, kind: 31971, created_at: 1, content: "Body", sig: "d".repeat(128), tags: [
  ["d", id], ["title", "Wallet setup is slow"], ["status", "open"], ["a", coordinate, "", "origin"]
] }, sidecar: { relayHints: ["wss://relay.example"] } } as never;

describe("problem view", () => {
  it("validates coordinates", () => expect(parseCoordinate(coordinate).problemId).toBe(id));
  it("selects current problem", () => expect(selectProblem(coordinate, [result]).title).toBe("Wallet setup is slow"));
  it("builds NIP-22 workflow tags", () => {
    const template = buildWorkflowTemplate(selectProblem(coordinate, [result]), "I can take this", "claim");
    expect(template.tags).toContainEqual(["claim"]);
    expect(template.tags).toContainEqual(["k", "31971"]);
  });
  it("finds distinct mentioned problem coordinates", () => {
    const other = `31971:${"e".repeat(64)}:${"f".repeat(64)}`;
    expect(relatedCoordinates(selectProblem(coordinate, [result]), [{ event: { tags: [["q", other]] } } as never])).toEqual([other]);
  });
});
