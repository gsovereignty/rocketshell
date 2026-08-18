import type { AclCheckEvent } from "@kehto/runtime";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

export type HostAuditRecord = Readonly<{
  id: string;
  timestamp: number;
  category: "acl" | "consent" | "unrouted-message";
  dTag?: string;
  aggregateHash?: string;
  capability?: string;
  decision?: "allow" | "deny";
  reason: string;
  messageType?: string;
  operation?: string;
}>;

export interface HostAuditTrail {
  recordAcl(event: AclCheckEvent): void;
  recordUnrouted(info: { readonly type?: string; readonly reason: string }): void;
  recordConsent(info: { readonly dTag?: string; readonly aggregateHash?: string; readonly operation: string; readonly allowed: boolean }): void;
  snapshot(): readonly HostAuditRecord[];
  clear(): void;
}

export function createHostAuditTrail(options: { readonly maximumRecords?: number; readonly now?: () => number; readonly randomId?: () => string; readonly telemetry?: PlatformTelemetry } = {}): HostAuditTrail {
  const maximumRecords = Math.max(1, options.maximumRecords ?? 500);
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const records: HostAuditRecord[] = [];
  const append = (record: Omit<HostAuditRecord, "id" | "timestamp">): void => {
    records.push(Object.freeze({ id: randomId(), timestamp: now(), ...record }));
    if (records.length > maximumRecords) records.splice(0, records.length - maximumRecords);
  };
  return {
    recordAcl(event) {
      telemetry.record("acl.outcome", 1, { decision: event.decision, capability: event.capability });
      append({
        category: "acl", dTag: event.identity.dTag, aggregateHash: event.identity.hash,
        capability: event.capability, decision: event.decision, reason: event.reason ?? "unspecified"
      });
    },
    recordUnrouted(info) {
      telemetry.record("message.unrouted", 1, { reason: info.reason, ...(info.type ? { messageType: info.type } : {}) });
      append({ category: "unrouted-message", reason: info.reason, ...(info.type ? { messageType: info.type } : {}) });
    },
    recordConsent(info) {
      telemetry.record("consent.outcome", 1, { decision: info.allowed ? "allow" : "deny", operation: info.operation });
      append({
        category: "consent", reason: "user-decision", decision: info.allowed ? "allow" : "deny",
        operation: info.operation, ...(info.dTag ? { dTag: info.dTag } : {}),
        ...(info.aggregateHash ? { aggregateHash: info.aggregateHash } : {})
      });
    },
    snapshot: () => Object.freeze(records.map((record) => Object.freeze({ ...record }))),
    clear: () => { records.length = 0; }
  };
}
