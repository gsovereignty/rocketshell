export const MERIT_REQUEST_CONVENTION = "napplet:composer/merit-request";

export interface MeritRequestPayload { problem: string }

export function parseMeritRequestPayload(payload: unknown): MeritRequestPayload | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const problem = (payload as { problem?: unknown }).problem;
  if (typeof problem !== "string" || !problem.trim()) return undefined;
  return { problem: problem.trim() };
}
