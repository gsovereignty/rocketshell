import { createReferenceShell, makeContext, runConformance } from "@napplet/conformance";
import { describe, expect, it } from "vitest";
import { PLATFORM_REQUIRED_DOMAINS } from "../src/index.js";

const envelopes: Record<string, unknown>[] = [
  { type: "identity.getPublicKey", id: "identity-1" },
  { type: "outbox.query", id: "outbox-1", filters: [{ kinds: [1] }] },
  { type: "relay.subscribe", id: "relay-1", subId: "subscription-1", filters: [{ kinds: [1] }] },
  { type: "storage.get", id: "storage-1", key: "settings" },
  { type: "resource.info", id: "resource-1" },
  { type: "config.get", id: "config-1" },
  { type: "theme.get", id: "theme-1" },
  { type: "intent.available", id: "intent-1", archetype: "viewer" },
  { type: "inc.subscribe", id: "inc-1", topic: "napplet:fixture/open" },
  { type: "link.open", id: "link-1", url: "https://example.com/" }
];

describe("platform NAP conformance", () => {
  it("passes every catalog check with manifest, wire, degradation, and lifecycle evidence", () => {
    const shell = createReferenceShell({ now: () => 1 });
    for (const envelope of envelopes) shell.handle(envelope);
    const manifestEvent = {
      kind: 35129,
      tags: [
        ["d", "reference-napplet"],
        ["path", "/index.html", "11".repeat(32)],
        ...PLATFORM_REQUIRED_DOMAINS.map((domain) => ["requires", domain])
      ]
    };
    const run = runConformance(makeContext({
      manifestEvent,
      emitted: [...shell.records],
      degraded: { bootError: null, emitted: [] },
      lifecycle: { listenerLeak: false }
    }));
    expect(run.ok).toBe(true);
    expect(run.checks.every((check) => check.status === "pass")).toBe(true);
    const coveredDomains = new Set(shell.records.map((record) => record.verdict.domain));
    expect(PLATFORM_REQUIRED_DOMAINS.every((domain) => coveredDomains.has(domain))).toBe(true);
  });
});
