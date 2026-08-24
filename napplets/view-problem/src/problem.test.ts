import { describe, expect, it, vi } from "vitest";
import { buildWorkflowTemplate, compareProblemRevisions, coordinateFromProblemEvent, formatClaimCountdown, hasClaimRequest, hasProblemChildren, mayEditProblem, parseCoordinate, problemEdits, problemRevisionAuthors, problemRevisionHistory, relatedCoordinates, resolveProblemAncestorOwners, selectEffectiveClaim, selectProblem } from "./problem";

const owner = "a".repeat(64);
const id = "b".repeat(64);
const revision = "c".repeat(64);
const coordinate = `31971:${owner}:${id}`;
const result = { event: { id: revision, pubkey: owner, kind: 31971, created_at: 1, content: "Body", sig: "d".repeat(128), tags: [
  ["d", id], ["title", "Wallet setup is slow"], ["status", "open"], ["a", coordinate, "", "origin"]
] }, sidecar: { relayHints: ["wss://relay.example"] } } as never;

describe("problem view", () => {
  it("validates coordinates", () => expect(parseCoordinate(coordinate).problemId).toBe(id));
  it("routes live revisions through owner and maintainer outboxes", () => {
    const maintainer = "e".repeat(64);
    const parentOwner = "f".repeat(64);
    expect(problemRevisionAuthors({ owner, maintainers: [maintainer, owner], parentOwners: [parentOwner] })).toEqual([owner, maintainer, parentOwner]);
  });
  it("selects current problem", () => expect(selectProblem(coordinate, [result]).title).toBe("Wallet setup is slow"));
  it("logs competing heads when current revision is ambiguous", () => {
    const competingId = "e".repeat(64);
    const competing = { event: {
      ...(result as unknown as { event: Record<string, unknown> }).event,
      id: competingId, pubkey: "f".repeat(64), created_at: 2
    }, sidecar: { relayHints: ["wss://other.example"] } } as never;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => selectProblem(coordinate, [result, competing]))
      .toThrow("Problem has multiple current heads. Merge revisions before viewing it here.");
    expect(consoleError).toHaveBeenCalledWith(
      "Could not select problem revision because current head count is not one.",
      expect.objectContaining({
        coordinate,
        headCount: 2,
        heads: [
          expect.objectContaining({ id: revision, author: owner, createdAt: 1 }),
          expect.objectContaining({ id: competingId, author: "f".repeat(64), createdAt: 2 })
        ]
      })
    );
    consoleError.mockRestore();
  });
  it("selects a newly received revision as current", () => {
    const next = { event: {
      ...(result as unknown as { event: Record<string, unknown> }).event,
      id: "e".repeat(64), created_at: 2, content: "Updated body",
      tags: [
        ["d", id], ["title", "Wallet setup is fast"], ["status", "open"],
        ["a", coordinate, "", "origin"], ["e", revision, "", "previous"]
      ]
    } } as never;
    const selected = selectProblem(coordinate, [result, next]);
    expect(selected.revisionId).toBe("e".repeat(64));
    expect(selected.title).toBe("Wallet setup is fast");
    expect(selected.description).toBe("Updated body");
  });
  it("lists every known revision newest first", () => {
    const next = { event: {
      ...(result as unknown as { event: Record<string, unknown> }).event,
      id: "e".repeat(64), pubkey: "f".repeat(64), created_at: 2, content: "Updated body",
      tags: [
        ["d", id], ["title", "Wallet setup is fast"], ["status", "closed"],
        ["a", coordinate, "", "origin"], ["e", revision, "", "previous"]
      ]
    } } as never;
    const history = problemRevisionHistory(coordinate, [result, next]);
    expect(history.map(({ id }) => id)).toEqual(["e".repeat(64), revision]);
    expect(history[0]).toMatchObject({ author: "f".repeat(64), status: "closed", previousIds: [revision] });
  });
  it("counts only revisions with a loaded predecessor as edits", () => {
    const initial = problemRevisionHistory(coordinate, [result])[0];
    const orphan = { ...initial, id: "e".repeat(64), previousIds: ["f".repeat(64)] };
    const edit = { ...initial, id: "1".repeat(64), previousIds: [initial.id] };
    expect(problemEdits([initial])).toEqual([]);
    expect(problemEdits([orphan, initial])).toEqual([]);
    expect(problemEdits([edit, initial])).toEqual([edit]);
  });
  it("reports fields changed by a revision", () => {
    const history = problemRevisionHistory(coordinate, [result]);
    const previous = history[0];
    const current = { ...previous, title: "Faster wallet setup", status: "claimed" };
    expect(compareProblemRevisions(previous, current)).toEqual([
      { field: "Title", before: "Wallet setup is slow", after: "Faster wallet setup" },
      { field: "Status", before: "open", after: "claimed" }
    ]);
    expect(compareProblemRevisions(undefined, previous).map(({ field }) => field))
      .toEqual(["Title", "Description", "Status", "Maintainers"]);
  });
  it("allows owner, current maintainer, or resolved ancestor owner to edit", () => {
    const maintainer = "e".repeat(64);
    const parentOwner = "f".repeat(64);
    const baseEvent = (result as unknown as { event: { tags: string[][] } }).event;
    const maintainedResult = { event: { ...baseEvent,
      tags: [...baseEvent.tags, ["p", maintainer, "", "maintainer"], ["p", parentOwner, "wss://parent.example"]] },
      sidecar: { relayHints: ["wss://relay.example"] } } as never;
    const problem = selectProblem(coordinate, [maintainedResult]);
    expect(mayEditProblem(problem, owner)).toBe(true);
    expect(mayEditProblem(problem, maintainer)).toBe(true);
    expect(mayEditProblem(problem, parentOwner)).toBe(true);
    expect(mayEditProblem(problem, "1".repeat(64))).toBe(false);
    expect(mayEditProblem(problem, "")).toBe(false);
  });
  it("resolves ancestor owners through every parent level", () => {
    const rootOwner = "d".repeat(64);
    const parentOwner = "e".repeat(64);
    const rootId = "1".repeat(64);
    const parentId = "2".repeat(64);
    const rootCoordinate = `31971:${rootOwner}:${rootId}`;
    const parentCoordinate = `31971:${parentOwner}:${parentId}`;
    const eventResult = (eventId: string, pubkey: string, problemId: string, origin: string, parents: string[] = []) => ({ event: {
      id: eventId, pubkey, kind: 31971, created_at: 1, content: "Body", sig: "f".repeat(128),
      tags: [["d", problemId], ["title", "Problem"], ["status", "open"], ["a", origin, "", "origin"],
        ["A", rootCoordinate], ...parents.map((parent) => ["a", parent])]
    } }) as never;
    const target = eventResult(revision, owner, id, coordinate, [parentCoordinate]);
    const parent = eventResult("3".repeat(64), parentOwner, parentId, parentCoordinate, [rootCoordinate]);
    const root = eventResult("4".repeat(64), rootOwner, rootId, rootCoordinate);
    const problem = selectProblem(coordinate, [target, parent, root]);
    const ancestors = resolveProblemAncestorOwners(problem, [target, parent, root]);
    expect(ancestors).toEqual([rootOwner, parentOwner].sort());
    expect(mayEditProblem(problem, rootOwner, ancestors)).toBe(true);
  });
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
      tags: [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]]
    } } as never;
    expect(hasClaimRequest(problem, [claim], owner)).toBe(true);
    expect(hasClaimRequest({ ...problem, revisionId: "0".repeat(64) }, [claim], owner)).toBe(false);
  });
  it("keeps the earliest coordinate claim active across ordinary revisions", () => {
    const problem = selectProblem(coordinate, [result]);
    const revisions = problemRevisionHistory(coordinate, [result]);
    const claim = (eventId: string, claimant: string, createdAt: number) => ({ event: {
      id: eventId, pubkey: claimant, kind: 1111, created_at: createdAt, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]]
    } }) as never;
    const later = claim("f".repeat(64), "1".repeat(64), 20);
    const earlier = claim("e".repeat(64), "2".repeat(64), 10);
    expect(selectEffectiveClaim(problem, [later, earlier], revisions)?.claimant).toBe("2".repeat(64));
    expect(selectEffectiveClaim(problem, [earlier], revisions)?.claimant).toBe("2".repeat(64));
  });
  it("keeps the real prior-revision claim active on the current open head", () => {
    const realOwner = "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075";
    const realProblemId = "c2b750295e3291976bdac8d281317ae99dbae49ffdd65311605f0d090d32fd3f";
    const realCoordinate = `31971:${realOwner}:${realProblemId}`;
    const currentId = "70ba7eda72eceecccfb28209ec289e7e92d2797200ee20b04e0f5f03294d5ad7";
    const priorId = "d8628bb25817788ee1b6cac81b7fad2aa26f7817f745f4c9bc080c6e5e7fd8e0";
    const problem = {
      coordinate: realCoordinate, rootCoordinate: realCoordinate, owner: realOwner, problemId: realProblemId,
      revisionId: "70ba7eda72eceecccfb28209ec289e7e92d2797200ee20b04e0f5f03294d5ad7",
      revisionAuthor: realOwner, revisionCreatedAt: 1787310942, relay: "wss://nos.lol/",
      title: "one more", description: "a more proper description again again", status: "open", maintainers: [], parentOwners: []
    };
    const claimId = "8d2610a358b1715db6373c6803dd79154f0c5153e58444aa9bcf143ec8e18e72";
    const claim = { event: {
      id: claimId,
      pubkey: realOwner, kind: 1111, created_at: 1787307148, content: "I am claiming this problem.", sig: "f".repeat(128),
      tags: [["A", realCoordinate], ["a", realCoordinate], ["e", priorId], ["claim"]]
    } } as never;
    const revisions = [{ id: currentId, author: realOwner, createdAt: 1787310942, title: "one more",
      description: problem.description, status: "open", maintainers: [], previousIds: [priorId] }];
    expect(selectEffectiveClaim(problem, [claim], revisions)?.eventId).toBe(claimId);
  });
  it("does not let stale claim data override completed statuses", () => {
    const problem = selectProblem(coordinate, [result]);
    const claimId = "e".repeat(64);
    const claim = { event: {
      id: claimId, pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]]
    } } as never;
    for (const status of ["patched", "closed"]) {
      expect(selectEffectiveClaim({ ...problem, status }, [claim], problemRevisionHistory(coordinate, [result]))).toBeUndefined();
      expect(selectEffectiveClaim({ ...problem, status, claim: { eventId: claimId, claimant: owner } }, [claim], problemRevisionHistory(coordinate, [result]))).toBeUndefined();
    }
  });
  it("uses an accepted claim as authoritative claimed state", () => {
    const problem = {
      ...selectProblem(coordinate, [result]), status: "claimed",
      claim: { eventId: "e".repeat(64), claimant: "1".repeat(64) }
    };
    expect(selectEffectiveClaim(problem, [], [])).toMatchObject({
      eventId: "e".repeat(64), claimant: "1".repeat(64), acknowledged: true
    });
  });
  it("does not treat an embedded claim on an open revision as accepted", () => {
    const problem = {
      ...selectProblem(coordinate, [result]), status: "open",
      claim: { eventId: "e".repeat(64), claimant: "1".repeat(64) }
    };
    expect(selectEffectiveClaim(problem, [], problemRevisionHistory(coordinate, [result]))).toBeUndefined();
  });
  it("accepts only unbroken all-open claim ancestry", () => {
    const problem = { ...selectProblem(coordinate, [result]), revisionId: "3".repeat(64) };
    const claim = { event: {
      id: "4".repeat(64), pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]]
    } } as never;
    const current = { id: problem.revisionId, author: owner, createdAt: 3, title: "Current", description: "",
      status: "open", maintainers: [], previousIds: ["2".repeat(64)] };
    const middle = { ...current, id: "2".repeat(64), createdAt: 2, previousIds: [revision] };
    expect(selectEffectiveClaim(problem, [claim], [current, middle])?.eventId).toBe("4".repeat(64));
    for (const status of ["closed", "patched"]) {
      expect(selectEffectiveClaim(problem, [claim], [current, { ...middle, status }])).toBeUndefined();
    }
    expect(selectEffectiveClaim(problem, [claim], [current])).toBeUndefined();
  });
  it("rejects a claim targeting a known non-open direct parent", () => {
    const problem = { ...selectProblem(coordinate, [result]), revisionId: "3".repeat(64) };
    const claim = { event: {
      id: "4".repeat(64), pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]]
    } } as never;
    const current = { id: problem.revisionId, author: owner, createdAt: 3, title: "Reopened", description: "",
      status: "open", maintainers: [], previousIds: [revision] };
    const target = { ...current, id: revision, createdAt: 2, previousIds: [] };
    for (const status of ["closed", "patched"]) {
      expect(selectEffectiveClaim(problem, [claim], [current, { ...target, status }])).toBeUndefined();
    }
  });
  it("rejects malformed or ambiguously scoped claim tags", () => {
    const problem = selectProblem(coordinate, [result]);
    const revisions = problemRevisionHistory(coordinate, [result]);
    const claim = (tags: string[][]) => ({ event: {
      id: "e".repeat(64), pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128), tags
    } }) as never;
    const base = [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]];
    expect(selectEffectiveClaim(problem, [claim([["A", coordinate], ["a", coordinate], ["e", "not-hex"], ["claim"]])], revisions)).toBeUndefined();
    expect(selectEffectiveClaim(problem, [claim([["A", coordinate], ["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]])], revisions)).toBeUndefined();
    expect(selectEffectiveClaim(problem, [claim(base.filter(([name]) => name !== "a"))], revisions)).toBeUndefined();
    expect(selectEffectiveClaim(problem, [claim([...base, ["a", coordinate]])], revisions)).toBeUndefined();
    expect(selectEffectiveClaim(problem, [claim(base.map((tag) => tag[0] === "a" ? ["a", `31971:${owner}:${"0".repeat(64)}`] : tag))], revisions)).toBeUndefined();
    expect(selectEffectiveClaim(problem, [claim(base.map((tag) => tag[0] === "claim" ? ["claim", "extra"] : tag))], revisions)).toBeUndefined();
    expect(selectEffectiveClaim(problem, [claim([...base, ["claim"]])], revisions)).toBeUndefined();
  });
  it("requires acknowledgement for rfm claims", () => {
    const problem = { ...selectProblem(coordinate, [result]), status: "rfm" };
    const claim = { event: {
      id: "e".repeat(64), pubkey: owner, kind: 1111, created_at: 2, content: "Claiming", sig: "f".repeat(128),
      tags: [["A", coordinate], ["a", coordinate], ["e", revision], ["claim"]]
    } } as never;
    expect(selectEffectiveClaim(problem, [claim], problemRevisionHistory(coordinate, [result]))).toBeUndefined();
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
  it("counts only current direct child heads", () => {
    const childCoordinate = `31971:${"e".repeat(64)}:${"f".repeat(64)}`;
    const child = (eventId: string, previousId?: string, parent = coordinate) => ({ event: {
      id: eventId, pubkey: "e".repeat(64), kind: 31971, created_at: 2, content: "Child", sig: "f".repeat(128),
      tags: [["d", "f".repeat(64)], ["a", childCoordinate, "", "origin"], ["a", parent],
        ...(previousId ? [["e", previousId, "", "previous"]] : [])]
    } }) as never;
    const genesis = child("1".repeat(64));
    expect(hasProblemChildren(coordinate, [genesis])).toBe(true);
    expect(hasProblemChildren(coordinate, [genesis, child("2".repeat(64), "1".repeat(64), `31971:${owner}:${"0".repeat(64)}`)])).toBe(false);
  });
});
