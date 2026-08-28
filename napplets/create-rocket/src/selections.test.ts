import { describe, expect, it, vi } from "vitest";
import { problemChoices, repositoryChoices, type ChoiceResult } from "./selections";

const owner = "a".repeat(64);
const problemId = "b".repeat(64);
const result = (changes: Partial<ChoiceResult["event"]> = {}, relayHints?: string[]): ChoiceResult => ({
  event: { id: "1".repeat(64), pubkey: owner, kind: 31971, created_at: 1, content: "Problem body", tags: [
    ["d", problemId], ["title", "Problem title"], ["a", `31971:${owner}:${problemId}`, "wss://origin.example", "origin"]
  ], ...changes },
  ...(relayHints ? { sidecar: { relayHints } } : {})
});

describe("rocket reference choices", () => {
  it("shows one current choice for each problem created by current user", () => {
    const previous = result();
    const current = result({ id: "2".repeat(64), created_at: 2, content: "Current body", tags: [
      ["d", problemId], ["title", "Current title"], ["a", `31971:${owner}:${problemId}`, "wss://origin.example", "origin"],
      ["e", previous.event.id, "", "previous"]
    ] }, ["wss://seen.example"]);
    expect(problemChoices([previous, current, result({ pubkey: "c".repeat(64) })], owner)).toEqual([{
      coordinate: `31971:${owner}:${problemId}`, relay: "wss://seen.example", title: "Current title", summary: "Current body", createdAt: 2
    }]);
  });

  it("rejects malformed problems and uses resolved author relay fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(problemChoices([result({ tags: [["d", "short"]] })], owner)).toEqual([]);
    expect(problemChoices([result({ tags: [["d", problemId], ["a", `31971:${owner}:${problemId}`, "", "origin"]] })], owner, ["not-a-relay", "wss://fallback.example"])[0]?.relay).toBe("wss://fallback.example");
    expect(warn).toHaveBeenCalledWith("Rocket reference relay hint validation failed", expect.objectContaining({ value: "not-a-relay" }));
    warn.mockRestore();
  });

  it("collapses repository replacements and derives labels", () => {
    const oldRepo = result({ kind: 30617, id: "3".repeat(64), created_at: 1, content: "", tags: [["d", "rocket"], ["name", "Old name"]] });
    const currentRepo = result({ kind: 30617, id: "4".repeat(64), created_at: 3, content: "", tags: [["d", "rocket"], ["name", "Rocket engine"], ["description", "Build rockets"]] }, ["wss://git.example"]);
    expect(repositoryChoices([oldRepo, currentRepo], owner)).toEqual([{
      coordinate: `30617:${owner}:rocket`, relay: "wss://git.example", title: "Rocket engine", summary: "Build rockets", createdAt: 3
    }]);
  });

  it("keeps long and unusual display text bounded", () => {
    const choice = repositoryChoices([result({ kind: 30617, tags: [["d", "repo"], ["name", "مستودع 🚀"], ["description", `  ${"x ".repeat(200)}`]] })], owner)[0]!;
    expect(choice.title).toBe("مستودع 🚀");
    expect([...choice.summary].length).toBe(180);
  });
});
