import { describe, expect, it } from "vitest";
import {
  PROBLEM_CHILD_ACTION, PROBLEM_CHILD_CONVENTION, PROBLEM_VIEWER_CONVENTION,
  PROBLEM_VIEWER_DTAG, hasProblemChildComposer, hasProblemViewer
} from "./problem-child-intent";

describe("problem child intent", () => {
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

describe("problem viewer intent", () => {
  it("requires the installed view-problem note handler", () => {
    expect(hasProblemViewer({ available: true, candidates: [
      { dTag: PROBLEM_VIEWER_DTAG, actions: ["open"], conventions: [PROBLEM_VIEWER_CONVENTION] }
    ] })).toBe(true);
    expect(hasProblemViewer({ available: true, candidates: [
      { dTag: "generic-note", actions: ["open"], conventions: [PROBLEM_VIEWER_CONVENTION] }
    ] })).toBe(false);
  });
});
