export const PROBLEM_CHILD_ARCHETYPE = "composer";
export const PROBLEM_CHILD_ACTION = "problem-child";
export const PROBLEM_CHILD_CONVENTION = "napplet:composer/problem-child";
export const PROBLEM_VIEWER_ARCHETYPE = "note";
export const PROBLEM_VIEWER_CONVENTION = "napplet:note/open";
const PROBLEM_VIEWER_BEHAVIOR = { focus: false, reuse: true } as const;
const PROBLEM_CHILD_ADJACENT_BEHAVIOR = { focus: false, reuse: true } as const;

interface ProblemChildIntent {
  invoke(request: {
    archetype: typeof PROBLEM_CHILD_ARCHETYPE;
    action: typeof PROBLEM_CHILD_ACTION;
    convention: typeof PROBLEM_CHILD_CONVENTION;
    payload: { problemId: string };
    behavior: typeof PROBLEM_CHILD_ADJACENT_BEHAVIOR;
  }): Promise<{ ok: boolean; handled: boolean; error?: string }>;
}

export function openAdjacentProblemChildComposer(intentApi: ProblemChildIntent, problemId: string) {
  return intentApi.invoke({
    archetype: PROBLEM_CHILD_ARCHETYPE,
    action: PROBLEM_CHILD_ACTION,
    convention: PROBLEM_CHILD_CONVENTION,
    payload: { problemId },
    behavior: PROBLEM_CHILD_ADJACENT_BEHAVIOR
  });
}

interface ProblemViewerIntent {
  open(
    archetype: string,
    payload: { target: { type: "event"; id: string } },
    options: { convention: string; behavior: typeof PROBLEM_VIEWER_BEHAVIOR }
  ): Promise<{ ok: boolean; handled: boolean; error?: string }>;
}

export function openProblemViewer(intentApi: ProblemViewerIntent, revisionId: string) {
  return intentApi.open(PROBLEM_VIEWER_ARCHETYPE, { target: { type: "event", id: revisionId } }, {
    convention: PROBLEM_VIEWER_CONVENTION,
    behavior: PROBLEM_VIEWER_BEHAVIOR
  });
}

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
