import { describe, expect, it } from "vitest";
import { createHostAuditTrail } from "../src/index.js";

describe("host audit trail", () => {
  it("bounds records and excludes raw triggering messages", () => {
    let id = 0;
    const audit = createHostAuditTrail({ maximumRecords: 1, now: () => 10, randomId: () => `id-${++id}` });
    audit.recordAcl({
      identity: { pubkey: "public", dTag: "notes", hash: "hash" }, capability: "relay:write",
      decision: "deny", reason: "capability-missing", message: ["EVENT", { content: "private body" }]
    });
    audit.recordUnrouted({ type: "shell.ready", reason: "unregistered-window" });
    expect(audit.snapshot()).toEqual([{ id: "id-2", timestamp: 10, category: "unrouted-message", reason: "unregistered-window", messageType: "shell.ready" }]);
    expect(JSON.stringify(audit.snapshot())).not.toContain("private body");
  });
});
