export const SERVICE_WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerRequest =
  | { readonly protocolVersion: 1; readonly requestId: string; readonly type: "PING" }
  | { readonly protocolVersion: 1; readonly requestId: string; readonly type: "PACKAGE_COMMITTED"; readonly dTag: string; readonly aggregateHash: string }
  | { readonly protocolVersion: 1; readonly requestId: string; readonly type: "ACTIVATE_UPDATE" };

export type WorkerReply =
  | { readonly protocolVersion: 1; readonly requestId: string; readonly buildId: string; readonly ok: true }
  | { readonly protocolVersion: 1; readonly requestId: string; readonly buildId: string; readonly ok: false; readonly error: "unsupported-protocol" | "invalid-request" };

export function parseWorkerRequest(value: unknown): WorkerRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== SERVICE_WORKER_PROTOCOL_VERSION || typeof message.requestId !== "string") return undefined;
  if (message.type === "PING" || message.type === "ACTIVATE_UPDATE") return message as WorkerRequest;
  if (message.type === "PACKAGE_COMMITTED" && typeof message.dTag === "string" && typeof message.aggregateHash === "string") return message as WorkerRequest;
  return undefined;
}
