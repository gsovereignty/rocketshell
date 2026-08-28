import { describe, expect, it, vi } from "vitest";
import {
  MERIT_REQUEST_ACTION, MERIT_REQUEST_CONVENTION, PROBLEM_CHILD_ACTION, PROBLEM_CHILD_CONVENTION, PROBLEM_VIEWER_CONVENTION,
  hasMeritRequestComposer, hasProblemChildComposer, hasProblemViewer, openAdjacentMeritRequest, openAdjacentProblemChildComposer, openProblemViewer
} from "./problem-child-intent";

describe("problem child intent", () => {
  it("opens a child composer without replacing the tree", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, handled: true });
    const problemId = "a".repeat(64);
    await openAdjacentProblemChildComposer({ invoke }, problemId);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith({
      archetype: "composer",
      action: PROBLEM_CHILD_ACTION,
      convention: PROBLEM_CHILD_CONVENTION,
      payload: { problemId },
      behavior: { focus: false, reuse: true }
    });
  });

  it("requires the convention-derived child action", () => {
    expect(hasProblemChildComposer({
      available: true,
      candidates: [{ actions: [PROBLEM_CHILD_ACTION], conventions: [PROBLEM_CHILD_CONVENTION] }]
    })).toBe(true);
    expect(hasProblemChildComposer({
      available: true,
      candidates: [{ actions: [PROBLEM_CHILD_ACTION], conventions: ["napplet:composer/open"] }]
    })).toBe(false);
    expect(hasProblemChildComposer({
      available: true,
      candidates: [{ actions: ["open"], conventions: [PROBLEM_CHILD_CONVENTION] }]
    })).toBe(false);
  });
});

describe("merit request intent", () => {
  it("opens merit composer beside problem tracker", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, handled: true });
    await openAdjacentMeritRequest({ invoke }, "Sidebar cannot show item names");
    expect(invoke).toHaveBeenCalledWith({
      archetype: "composer",
      action: MERIT_REQUEST_ACTION,
      convention: MERIT_REQUEST_CONVENTION,
      payload: { problem: "Sidebar cannot show item names" },
      behavior: { focus: false, reuse: true }
    });
  });

  it("requires matching merit action and convention", () => {
    expect(hasMeritRequestComposer({ available: true, candidates: [
      { actions: [MERIT_REQUEST_ACTION], conventions: [MERIT_REQUEST_CONVENTION] }
    ] })).toBe(true);
    expect(hasMeritRequestComposer({ available: true, candidates: [
      { actions: ["open"], conventions: [MERIT_REQUEST_CONVENTION] }
    ] })).toBe(false);
  });
});

describe("problem viewer intent", () => {
  it("dispatches the selected revision without replacing the DAG", async () => {
    const open = vi.fn().mockResolvedValue({ ok: true, handled: true });
    await openProblemViewer({ open }, "a".repeat(64));
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      "note",
      { target: { type: "event", id: "a".repeat(64) } },
      { convention: PROBLEM_VIEWER_CONVENTION, behavior: { focus: false, reuse: true } }
    );
  });

  it("requires an open handler for the note convention", () => {
    expect(hasProblemViewer({ available: true, candidates: [
      { actions: ["open"], conventions: [PROBLEM_VIEWER_CONVENTION] }
    ] })).toBe(true);
    expect(hasProblemViewer({ available: true, candidates: [
      { actions: ["edit"], conventions: [PROBLEM_VIEWER_CONVENTION] }
    ] })).toBe(false);
  });
});
