export const MERIT_REQUEST_ARCHETYPE = "composer";
export const MERIT_REQUEST_ACTION = "merit-request";
export const MERIT_REQUEST_CONVENTION = "napplet:composer/merit-request";
const MERIT_REQUEST_BEHAVIOR = { focus: false, reuse: true } as const;

interface MeritRequestIntent {
  invoke(request: {
    archetype: typeof MERIT_REQUEST_ARCHETYPE;
    action: typeof MERIT_REQUEST_ACTION;
    convention: typeof MERIT_REQUEST_CONVENTION;
    payload: { problem: string };
    behavior: typeof MERIT_REQUEST_BEHAVIOR;
  }): Promise<{ ok: boolean; handled: boolean; error?: string }>;
}

export const canRequestMerits = (status: string): boolean => status === "closed";

export function openAdjacentMeritRequest(intentApi: MeritRequestIntent, problem: string) {
  return intentApi.invoke({
    archetype: MERIT_REQUEST_ARCHETYPE,
    action: MERIT_REQUEST_ACTION,
    convention: MERIT_REQUEST_CONVENTION,
    payload: { problem },
    behavior: MERIT_REQUEST_BEHAVIOR
  });
}
