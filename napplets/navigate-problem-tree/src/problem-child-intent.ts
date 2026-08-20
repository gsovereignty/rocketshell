export const PROBLEM_CHILD_ARCHETYPE = "composer";
export const PROBLEM_CHILD_CONVENTION = "napplet:composer/problem-child";

interface IntentCandidateLike {
  actions: readonly string[];
  conventions: readonly string[];
}

interface IntentAvailabilityLike {
  available: boolean;
  candidates: readonly IntentCandidateLike[];
}

export function hasProblemChildComposer(availability: IntentAvailabilityLike | undefined): boolean {
  return availability?.available === true && availability.candidates.some((candidate) =>
    candidate.actions.includes("open") && candidate.conventions.includes(PROBLEM_CHILD_CONVENTION));
}
