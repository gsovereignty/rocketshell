import { describe, expect, it } from "vitest";
import { createHostAuditTrail } from "../src/index.js";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

describe("host audit trail", () => {
  it("bounds records and excludes raw triggering messages", () => {
    let id = 0;
    const telemetry = createPlatformTelemetry();
    const audit = createHostAuditTrail({ maximumRecords: 2, now: () => 10, randomId: () => `id-${++id}`, telemetry });
    audit.recordAcl({
      identity: { pubkey: "public", dTag: "notes", hash: "hash" }, capability: "relay:write",
      decision: "deny", reason: "capability-missing", message: ["EVENT", { content: "private body" }]
    });
    audit.recordUnrouted({ type: "shell.ready", reason: "unregistered-window" });
    audit.recordConsent({ dTag: "notes", aggregateHash: "hash", operation: "sign-kind:5", allowed: false });
    expect(audit.snapshot()).toEqual([
      { id: "id-2", timestamp: 10, category: "unrouted-message", reason: "unregistered-window", messageType: "shell.ready" },
      { id: "id-3", timestamp: 10, category: "consent", reason: "user-decision", decision: "deny", operation: "sign-kind:5", dTag: "notes", aggregateHash: "hash" }
    ]);
    expect(JSON.stringify(audit.snapshot())).not.toContain("private body");
    expect(telemetry.snapshot().map((record) => record.name)).toEqual(["acl.outcome", "message.unrouted", "consent.outcome"]);
  });
});
