export const FAILURE_CODES = [
  "unsupported", "permission-denied", "consent-denied", "signed-out",
  "signer-unavailable", "invalid-request", "invalid-filter", "invalid-event",
  "invalid-signature", "relay-denied", "relay-unavailable", "relay-timeout",
  "publish-rejected", "query-timeout", "resource-denied", "resource-too-large",
  "storage-quota", "intent-unhandled", "window-destroyed", "internal-error"
] as const;

export type PlatformFailureCode = (typeof FAILURE_CODES)[number];

export interface PlatformFailure {
  readonly code: PlatformFailureCode;
  readonly message: string;
  readonly diagnosticId?: string;
}

const codeSet = new Set<string>(FAILURE_CODES);

export function isPlatformFailure(value: unknown): value is PlatformFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && codeSet.has(candidate.code)
    && typeof candidate.message === "string"
    && (candidate.diagnosticId === undefined || typeof candidate.diagnosticId === "string");
}

export function failure(code: PlatformFailureCode, message: string, diagnosticId?: string): PlatformFailure {
  return diagnosticId === undefined ? { code, message } : { code, message, diagnosticId };
}
