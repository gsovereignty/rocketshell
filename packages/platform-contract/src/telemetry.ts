export type PlatformMetricName =
  | "relay.connection" | "relay.authentication" | "relay.reconnect"
  | "query.completed" | "query.first-event" | "query.eose"
  | "event.received" | "event.admitted" | "event.rejected" | "event.duplicate"
  | "event.deleted" | "event.expired" | "event.replaceable-conflict" | "publication.outcome" | "publication.failed"
  | "window.active" | "subscription.active" | "subscription.cleanup" | "callback.suppressed"
  | "acl.outcome" | "consent.outcome" | "resource.bytes" | "resource.timeout"
  | "resource.denied" | "intent.completed" | "message.unrouted" | "protocol.failure";

export type MetricLabels = Readonly<Record<string, string | number | boolean>>;
export interface PlatformMetricRecord {
  readonly name: PlatformMetricName;
  readonly value: number;
  readonly timestamp: number;
  readonly labels: MetricLabels;
}
export interface PlatformTelemetry {
  record(name: PlatformMetricName, value?: number, labels?: MetricLabels): void;
  snapshot(): readonly PlatformMetricRecord[];
  clear(): void;
}

const sensitiveLabel = /authorization|content|cookie|key|payload|secret|seed|signature|token/i;

export function createPlatformTelemetry(options: { readonly maximumRecords?: number; readonly now?: () => number } = {}): PlatformTelemetry {
  const maximumRecords = Math.max(1, options.maximumRecords ?? 2_000);
  const now = options.now ?? Date.now;
  const records: PlatformMetricRecord[] = [];
  return {
    record(name, value = 1, labels = {}) {
      const safeLabels = Object.fromEntries(Object.entries(labels).filter(([key]) => !sensitiveLabel.test(key)));
      records.push(Object.freeze({ name, value, timestamp: now(), labels: Object.freeze(safeLabels) }));
      if (records.length > maximumRecords) records.splice(0, records.length - maximumRecords);
    },
    snapshot: () => Object.freeze(records.map((record) => Object.freeze({ ...record, labels: Object.freeze({ ...record.labels }) }))),
    clear: () => { records.length = 0; }
  };
}

export const NOOP_TELEMETRY: PlatformTelemetry = Object.freeze({
  record() {}, snapshot: () => Object.freeze([]), clear() {}
});
