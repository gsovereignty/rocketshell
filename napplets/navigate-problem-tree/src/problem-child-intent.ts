export const PROBLEM_CHILD_ARCHETYPE = "composer";
export const PROBLEM_CHILD_ACTION = "problem-child";
export const PROBLEM_CHILD_CONVENTION = "napplet:composer/problem-child";
export const PROBLEM_VIEWER_ARCHETYPE = "note";
export const PROBLEM_VIEWER_CONVENTION = "napplet:note/open";

interface IntentCandidateLike {
  actions: readonly string[];
  conventions: readonly string[];
}

export function hasProblemViewer(availability: IntentAvailabilityLike | undefined): boolean {
  return availability?.available === true && availability.candidates.some((candidate) =>
    candidate.actions.includes("open") && candidate.conventions.includes(PROBLEM_VIEWER_CONVENTION));
}

interface IntentAvailabilityLike {
  available: boolean;
  candidates: readonly IntentCandidateLike[];
}

export function hasProblemChildComposer(availability: IntentAvailabilityLike | undefined): boolean {
  return availability?.available === true && availability.candidates.some((candidate) =>
    candidate.actions.includes(PROBLEM_CHILD_ACTION) && candidate.conventions.includes(PROBLEM_CHILD_CONVENTION));
}
