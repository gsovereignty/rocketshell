import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { freshAdapters } from "./fresh.js";

describe("NAP-IDENTITY providers", () => {
  it("revalidates a cached replaceable list and keeps the newer relay version", async () => {
    const { engine, adapters } = await freshAdapters();
    const secret = generateSecretKey();
    const cached = finalizeEvent({
      kind: 30_001,
      created_at: 1,
      tags: [["d", "reading"], ["e", "aa".repeat(32)]],
      content: ""
    }, secret);
    const current = finalizeEvent({
      kind: 30_001,
      created_at: 2,
      tags: [["d", "reading"], ["e", "bb".repeat(32)]],
      content: ""
    }, secret);
    engine.ingress.admit(cached, "cache:indexeddb");
    engine.fallbackLookupRelays$.next(["wss://relay.example"]);
    const request = vi.spyOn(engine.relayPool, "request").mockImplementation(() => {
      engine.ingress.admit(current, "wss://relay.example");
      return of(current) as ReturnType<typeof engine.relayPool.request>;
    });
    const identity = adapters.createIdentityProviders(["wss://relay.example"]);

    await expect(identity.getList("reading", cached.pubkey)).resolves.toEqual(["bb".repeat(32)]);
    expect(request).toHaveBeenCalled();
    expect(engine.eventStore.getReplaceable(30_001, cached.pubkey, "reading")?.id).toBe(current.id);
    engine.shutdownNostrServices();
  });

  it("revalidates a cached query and admits relay results into the shared EventStore", async () => {
    const { engine, adapters } = await freshAdapters();
    const userSecret = generateSecretKey();
    const senderSecret = generateSecretKey();
    const user = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: "{}" }, userSecret);
    const cached = finalizeEvent({
      kind: 9735,
      created_at: 1,
      tags: [["p", user.pubkey], ["bolt11", "malformed-cached"]],
      content: ""
    }, senderSecret);
    const current = finalizeEvent({
      kind: 9735,
      created_at: 2,
      tags: [["p", user.pubkey], ["bolt11", "malformed-current"]],
      content: ""
    }, senderSecret);
    engine.ingress.admit(cached, "cache:indexeddb");
    const request = vi.spyOn(engine.relayPool, "request").mockImplementation(() => {
      engine.ingress.admit(current, "wss://relay.example");
      return of(current) as ReturnType<typeof engine.relayPool.request>;
    });
    const identity = adapters.createIdentityProviders(["wss://relay.example"]);

    await identity.getZaps(user.pubkey);
    expect(request).toHaveBeenCalledWith(
      ["wss://relay.example/"],
      { kinds: [9735], "#p": [user.pubkey] },
      expect.objectContaining({ eventStore: engine.eventStore })
    );
    expect(engine.eventStore.getEvent(current.id)?.id).toBe(current.id);
    engine.shutdownNostrServices();
  });

  it("keeps cached query data when relay revalidation fails", async () => {
    const { engine, adapters } = await freshAdapters();
    const userSecret = generateSecretKey();
    const senderSecret = generateSecretKey();
    const user = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: "{}" }, userSecret);
    const cached = finalizeEvent({
      kind: 9735,
      created_at: 1,
      tags: [["p", user.pubkey], ["bolt11", "malformed-cached"]],
      content: ""
    }, senderSecret);
    engine.ingress.admit(cached, "cache:indexeddb");
    const request = vi.spyOn(engine.relayPool, "request").mockReturnValue(
      throwError(() => new Error("relay unavailable")) as ReturnType<typeof engine.relayPool.request>
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const identity = adapters.createIdentityProviders(["wss://relay.example"]);

    await identity.getZaps(user.pubkey);
    expect(request).toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "NAP-IDENTITY query relay refresh failed",
      expect.objectContaining({ error: expect.any(Error), kinds: [9735], authorCount: 0, relayCount: 1 })
    );
    expect(engine.eventStore.getEvent(cached.id)?.id).toBe(cached.id);
    engine.shutdownNostrServices();
  });

  it("revalidates cached model-backed profile data before returning", async () => {
    const { engine, adapters } = await freshAdapters();
    const secret = generateSecretKey();
    const cached = finalizeEvent({
      kind: 0, created_at: 1, tags: [], content: JSON.stringify({ name: "Old name" })
    }, secret);
    const current = finalizeEvent({
      kind: 0, created_at: 2, tags: [], content: JSON.stringify({ name: "Current name" })
    }, secret);
    engine.ingress.admit(cached, "cache:indexeddb");
    const request = vi.spyOn(engine.relayPool, "request").mockImplementation(() => {
      engine.ingress.admit(current, "wss://relay.example");
      return of(current) as ReturnType<typeof engine.relayPool.request>;
    });
    const identity = adapters.createIdentityProviders(["wss://relay.example"]);

    await expect(identity.getProfile(cached.pubkey)).resolves.toEqual({
      name: "Current name", displayName: "Current name"
    });
    expect(request).toHaveBeenCalledWith(
      ["wss://relay.example/"],
      { kinds: [0], authors: [cached.pubkey] },
      expect.objectContaining({ eventStore: engine.eventStore })
    );
    engine.shutdownNostrServices();
  });

  it("uses cached replaceable data offline without clearing it", async () => {
    const { engine, adapters } = await freshAdapters();
    const secret = generateSecretKey();
    const cached = finalizeEvent({
      kind: 3, created_at: 1, tags: [["p", "aa".repeat(32)]], content: ""
    }, secret);
    engine.ingress.admit(cached, "cache:indexeddb");
    const request = vi.spyOn(engine.relayPool, "request");
    const identity = adapters.createIdentityProviders([]);

    await expect(identity.lookupReplaceable(3, cached.pubkey)).resolves.toMatchObject({
      status: "found", event: { id: cached.id }
    });
    expect(request).not.toHaveBeenCalled();
    engine.shutdownNostrServices();
  });

  it("keeps cached replaceable data when relay hints violate policy", async () => {
    const { engine, adapters } = await freshAdapters();
    const secret = generateSecretKey();
    const cached = finalizeEvent({
      kind: 3, created_at: 1, tags: [["p", "aa".repeat(32)]], content: ""
    }, secret);
    engine.ingress.admit(cached, "cache:indexeddb");
    const request = vi.spyOn(engine.relayPool, "request");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const identity = adapters.createIdentityProviders(["wss://relay.example"]);

    await expect(identity.lookupReplaceable(3, cached.pubkey, {
      hints: ["https://not-a-relay.example"]
    })).resolves.toMatchObject({ status: "found", event: { id: cached.id } });
    expect(request).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "NAP-IDENTITY replaceable lookup relay refresh failed",
      expect.objectContaining({ error: expect.any(Error), kinds: [3], authorCount: 1, relayCount: 0 })
    );
    engine.shutdownNostrServices();
  });

  it("resolves every replaceable identity view from the shared EventStore", async () => {
    const { engine, adapters } = await freshAdapters();
    const userSecret = generateSecretKey();
    const userEvent = (kind: number, tags: string[][], content = "") => finalizeEvent({ kind, created_at: kind, tags, content }, userSecret);
    const profile = userEvent(0, [], JSON.stringify({ name: "alice", display_name: "Alice", picture: "https://media.example/alice.png" }));
    const pubkey = profile.pubkey;
    const events = [
      profile,
      userEvent(3, [["p", "11".repeat(32)], ["p", "11".repeat(32)], ["p", "invalid"]]),
      userEvent(10_002, [["r", "wss://relay.damus.io"], ["r", "wss://nos.lol", "read"], ["r", "wss://relay.primal.net", "write"]]),
      userEvent(10_001, [["e", "aa".repeat(32)], ["title", "Pinned"]]),
      userEvent(30_001, [["d", "reading"], ["a", `30023:${pubkey}:article`], ["r", "https://example.com/article"]]),
      userEvent(10_000, [["p", "22".repeat(32)], ["word", "spam"]]),
      userEvent(30_000, [["d", "blocked"], ["p", "33".repeat(32)]])
    ];
    for (const event of events) engine.ingress.admit(event, "local:test");
    const identity = adapters.createIdentityProviders([]);

    await expect(identity.getProfile(pubkey)).resolves.toEqual({ name: "alice", displayName: "Alice", picture: "https://media.example/alice.png" });
    await expect(identity.getFollows(pubkey)).resolves.toEqual(["11".repeat(32)]);
    await expect(identity.getRelays(pubkey)).resolves.toEqual({
      "wss://relay.damus.io/": { read: true, write: true },
      "wss://nos.lol/": { read: true, write: false },
      "wss://relay.primal.net/": { read: false, write: true }
    });
    await expect(identity.getList("pins", pubkey)).resolves.toEqual(["aa".repeat(32)]);
    await expect(identity.getList("reading", pubkey)).resolves.toEqual([`30023:${pubkey}:article`, "https://example.com/article"]);
    await expect(identity.getMutes(pubkey)).resolves.toEqual(["22".repeat(32)]);
    await expect(identity.getBlocked(pubkey)).resolves.toEqual(["33".repeat(32)]);
    await expect(identity.getList("", pubkey)).resolves.toEqual([]);
    engine.shutdownNostrServices();
  });

  it("resolves NIP-57 receipts and NIP-58 awards while omitting malformed data", async () => {
    const { engine, adapters } = await freshAdapters();
    const userSecret = generateSecretKey();
    const issuerSecret = generateSecretKey();
    const user = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: "{}" }, userSecret);
    const definition = finalizeEvent({
      kind: 30_009, created_at: 2,
      tags: [["d", "early-adopter"], ["name", "Early Adopter"], ["description", "Arrived early"], ["image", "https://media.example/badge.png"], ["thumb", "https://media.example/thumb.png"]], content: ""
    }, issuerSecret);
    const pointer = `30009:${definition.pubkey}:early-adopter`;
    const award = finalizeEvent({ kind: 8, created_at: 3, tags: [["a", pointer], ["p", user.pubkey]], content: "" }, issuerSecret);
    const zapRequest = finalizeEvent({ kind: 9734, created_at: 3, tags: [["p", user.pubkey], ["relays", "wss://relay.damus.io"]], content: "Great work!" }, issuerSecret);
    const invoice = "lnbc100n1p5pjxjk9qypqqqdqqxqrrsssp54ttukd5xxy2nmdzf864yjereuf9v3pyzl66hpqgxa0e8fvlzf6aspp5z6twjtwde82ec7wfcqw2m63v48r6fyw78753wxh7zjlvuru7tapsp6c9lq6m4d55u9jkxuqpepdknnzznfu05wl73swyn52z3pnkzyxrlkqf3t5jkw2hq7ukasuh5wgazvfwkkzrf0aqk4k0zluzu4rx8wqq8sut0l";
    const validZap = finalizeEvent({ kind: 9735, created_at: 4, tags: [["p", user.pubkey], ["P", definition.pubkey], ["bolt11", invoice], ["description", JSON.stringify(zapRequest)]], content: "" }, issuerSecret);
    const malformedZap = finalizeEvent({ kind: 9735, created_at: 4, tags: [["p", user.pubkey], ["P", definition.pubkey], ["bolt11", "not-an-invoice"]], content: "" }, issuerSecret);
    for (const event of [user, definition, award, validZap, malformedZap]) engine.ingress.admit(event, "local:test");
    const identity = adapters.createIdentityProviders([]);

    await expect(identity.getBadges(user.pubkey)).resolves.toEqual([{
      id: pointer,
      name: "Early Adopter",
      description: "Arrived early",
      image: "https://media.example/badge.png",
      thumbs: ["https://media.example/thumb.png"],
      awardedBy: definition.pubkey
    }]);
    await expect(identity.getZaps(user.pubkey)).resolves.toEqual([{
      eventId: validZap.id, sender: definition.pubkey, amount: 10_000, content: "Great work!"
    }]);
    engine.shutdownNostrServices();
  });
});
