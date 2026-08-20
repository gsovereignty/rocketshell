import { describe, expect, it } from "vitest";
import {
  PROBLEM_CHILD_ACTION, PROBLEM_CHILD_CONVENTION, hasProblemChildComposer
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
