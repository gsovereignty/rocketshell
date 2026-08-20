import { describe, expect, it } from "vitest";
import { PROBLEM_CHILD_CONVENTION, hasProblemChildComposer } from "./problem-child-intent";

describe("problem child intent", () => {
  it("requires an open handler for the exact child convention", () => {
    expect(hasProblemChildComposer({
      available: true,
      candidates: [{ actions: ["open"], conventions: [PROBLEM_CHILD_CONVENTION] }]
    })).toBe(true);
    expect(hasProblemChildComposer({
      available: true,
      candidates: [{ actions: ["open"], conventions: ["napplet:composer/open"] }]
    })).toBe(false);
    expect(hasProblemChildComposer({
      available: true,
      candidates: [{ actions: ["edit"], conventions: [PROBLEM_CHILD_CONVENTION] }]
    })).toBe(false);
  });
});
