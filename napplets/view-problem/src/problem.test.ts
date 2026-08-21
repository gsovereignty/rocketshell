import { describe, expect, it } from "vitest";
import { buildWorkflowTemplate, coordinateFromProblemEvent, formatClaimCountdown, hasClaimRequest, parseCoordinate, relatedCoordinates, selectEffectiveClaim, selectProblem } from "./problem";

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
  it("resolves intent event targets to logical coordinates", () =>
    expect(coordinateFromProblemEvent((result as { event: never }).event)).toBe(coordinate));
  it("builds NIP-22 workflow tags", () => {
    const template = buildWorkflowTemplate(selectProblem(coordinate, [result]), "I can take this", "claim");
    expect(template.tags).toContainEqual(["claim"]);
    expect(template.tags).toContainEqual(["k", "31971"]);
  });
  it("finds a pending claim for the current revision", () => {
    const problem = selectProblem(coordinate, [result]);
    const claim = { event: {
      id: "e".repeat(64), pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["e", revision], ["claim"]]
    } } as never;
    expect(hasClaimRequest(problem, [claim], owner)).toBe(true);
    expect(hasClaimRequest({ ...problem, revisionId: "0".repeat(64) }, [claim], owner)).toBe(false);
  });
  it("selects the earliest unexpired best-effort claim", () => {
    const problem = selectProblem(coordinate, [result]);
    const claim = (eventId: string, claimant: string, createdAt: number) => ({ event: {
      id: eventId, pubkey: claimant, kind: 1111, created_at: createdAt, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["e", revision], ["claim"]]
    } }) as never;
    const later = claim("f".repeat(64), "1".repeat(64), 20);
    const earlier = claim("e".repeat(64), "2".repeat(64), 10);
    expect(selectEffectiveClaim(problem, [later, earlier], 30)?.claimant).toBe("2".repeat(64));
    expect(selectEffectiveClaim(problem, [earlier], 86_410)).toBeUndefined();
  });
  it("requires acknowledgement for rfm claims", () => {
    const problem = { ...selectProblem(coordinate, [result]), status: "rfm" };
    const claim = { event: {
      id: "e".repeat(64), pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["e", revision], ["claim"]]
    } } as never;
    expect(selectEffectiveClaim(problem, [claim], 3)).toBeUndefined();
  });
  it("formats a 24-hour countdown", () => {
    expect(formatClaimCountdown(86_400)).toBe("24:00:00");
    expect(formatClaimCountdown(3_661)).toBe("01:01:01");
    expect(formatClaimCountdown(-1)).toBe("00:00:00");
  });
  it("finds distinct mentioned problem coordinates", () => {
    const other = `31971:${"e".repeat(64)}:${"f".repeat(64)}`;
    expect(relatedCoordinates(selectProblem(coordinate, [result]), [{ event: { tags: [["q", other]] } } as never])).toEqual([other]);
  });
});
