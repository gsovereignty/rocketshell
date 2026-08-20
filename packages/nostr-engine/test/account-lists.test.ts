import { describe, expect, it } from "vitest";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import {
  BLOSSOM_SERVER_LIST_KIND, MAILBOX_LIST_KIND, createAccountListEditor,
  type AccountListEditorOptions, type ReplaceableLookup
} from "../src/account-lists.js";
import { createRelayPolicy } from "../src/relay-policy.js";
import type { PublicationResult, RelayPublisher } from "../src/relay-publish.js";

const PUBKEY = "d8dd41ef1e287dfc668d2473fbef8fa9deea5c2ef03947105ef568e68827e7e4";

const signTemplate = (template: EventTemplate): NostrEvent => ({
  ...template, id: `id-${template.kind}-${template.tags.length}`, pubkey: PUBKEY, sig: "sig"
});

const relayListEvent = (tags: string[][]): NostrEvent =>
  signTemplate({ kind: MAILBOX_LIST_KIND, created_at: 1_700_000_000, content: "", tags });

const serverListEvent = (servers: string[]): NostrEvent =>
  signTemplate({ kind: BLOSSOM_SERVER_LIST_KIND, created_at: 1_700_000_000, content: "", tags: servers.map((server) => ["server", server]) });

function harness(lookup: (kind: number) => ReplaceableLookup, options: { publicKey?: string } = {}) {
  const published: { relays: readonly string[]; event: NostrEvent }[] = [];
  const publisher: RelayPublisher = {
    publishSigned: async (relays, event): Promise<PublicationResult> => {
      published.push({ relays, event });
      return { event, outcomes: [], accepted: 1 };
    },
    publishTemplate: async () => { throw new Error("unused"); }
  };
  const engine = {
    accounts: { publicKey: options.publicKey ?? PUBKEY, sign: async (template: EventTemplate) => signTemplate(template) },
    relayPolicy: createRelayPolicy({ maximumRelays: 4 })
  };
  const editorOptions: AccountListEditorOptions = {
    publisher,
    lookup: async (kind) => lookup(kind),
    publishRelays: () => ["wss://publish.test/"]
  };
  return { editor: createAccountListEditor(engine, editorOptions), published };
}

describe("account list editor", () => {
  it("preserves existing relays when adding to a published NIP-65 list", async () => {
    const existing = relayListEvent([["r", "wss://keep.test/"], ["r", "wss://read-only.test/", "read"]]);
    const { editor, published } = harness(() => ({ status: "found", event: existing }));

    await editor.addMailboxRelay("wss://new.test");

    expect(published).toHaveLength(1);
    const event = published[0]!.event;
    expect(event.kind).toBe(MAILBOX_LIST_KIND);
    expect(getOutboxes(event)).toEqual(expect.arrayContaining(["wss://keep.test/", "wss://new.test/"]));
    expect(getInboxes(event)).toEqual(expect.arrayContaining(["wss://keep.test/", "wss://read-only.test/", "wss://new.test/"]));
  });

  it("adds one side of the list without touching the other", async () => {
    const existing = relayListEvent([["r", "wss://keep.test/"]]);
    const { editor, published } = harness(() => ({ status: "found", event: existing }));

    await editor.addMailboxRelay("wss://inbox.test", "inbox");

    const event = published[0]!.event;
    expect(getInboxes(event)).toContain("wss://inbox.test/");
    expect(getOutboxes(event)).not.toContain("wss://inbox.test/");
  });

  it("creates a list when the account has genuinely never published one", async () => {
    const { editor, published } = harness(() => ({ status: "absent" }));

    await editor.addMailboxRelay("wss://first.test");

    expect(getOutboxes(published[0]!.event)).toEqual(["wss://first.test/"]);
  });

  it("refuses to publish when the existing list could not be loaded", async () => {
    // Rebuilding from scratch here would replace the user's real list with a one-relay event.
    const { editor, published } = harness(() => ({ status: "unavailable", reason: "relay-timeout" }));

    await expect(editor.addMailboxRelay("wss://new.test")).rejects.toThrow("relay-timeout");
    await expect(editor.removeMailboxRelay("wss://new.test")).rejects.toThrow("relay-timeout");
    await expect(editor.addBlossomServer("https://cdn.example")).rejects.toThrow("relay-timeout");
    expect(published).toHaveLength(0);
  });

  it("refuses to remove from a list that was never published", async () => {
    const { editor, published } = harness(() => ({ status: "absent" }));

    await expect(editor.removeMailboxRelay("wss://gone.test")).rejects.toThrow("list-not-published");
    expect(published).toHaveLength(0);
  });

  it("removes a relay while leaving the rest of the list intact", async () => {
    const existing = relayListEvent([["r", "wss://keep.test/"], ["r", "wss://drop.test/"]]);
    const { editor, published } = harness(() => ({ status: "found", event: existing }));

    await editor.removeMailboxRelay("wss://drop.test");

    const event = published[0]!.event;
    expect(getOutboxes(event)).toEqual(["wss://keep.test/"]);
    expect(getInboxes(event)).toEqual(["wss://keep.test/"]);
  });

  it("rejects relay URLs the platform policy forbids", async () => {
    const { editor, published } = harness(() => ({ status: "absent" }));

    await expect(editor.addMailboxRelay("http://insecure.example")).rejects.toThrow("Relay scheme forbidden");
    await expect(editor.addMailboxRelay("wss://user:pass@relay.test")).rejects.toThrow("credentials forbidden");
    expect(published).toHaveLength(0);
  });

  it("rejects an addition that exceeds the platform relay budget", async () => {
    const existing = relayListEvent([
      ["r", "wss://a.test/"], ["r", "wss://b.test/"], ["r", "wss://c.test/"], ["r", "wss://d.test/"]
    ]);
    const { editor, published } = harness(() => ({ status: "found", event: existing }));

    await expect(editor.addMailboxRelay("wss://e.test")).rejects.toThrow("Relay limit exceeded");
    expect(published).toHaveLength(0);
  });

  it("reads and edits the BUD-03 server list", async () => {
    // The lookup reflects each published edit, so the two calls chain like they would against a relay.
    let stored = serverListEvent(["https://keep.example/"]);
    const { editor, published } = harness(() => ({ status: "found", event: stored }));

    expect((await editor.readBlossomServers()).servers).toEqual(["https://keep.example/"]);

    stored = await editor.addBlossomServer("https://cdn.example");
    expect(published[0]!.event.kind).toBe(BLOSSOM_SERVER_LIST_KIND);
    expect((await editor.readBlossomServers()).servers).toEqual(expect.arrayContaining(["https://cdn.example/", "https://keep.example/"]));

    stored = await editor.removeBlossomServer("https://keep.example");
    expect((await editor.readBlossomServers()).servers).toEqual(["https://cdn.example/"]);
  });

  it("reports an empty list rather than throwing when nothing is published", async () => {
    const { editor } = harness(() => ({ status: "absent" }));
    expect(await editor.readMailboxes()).toEqual({ inboxes: [], outboxes: [] });
    expect(await editor.readBlossomServers()).toEqual({ servers: [] });
  });

  it("requires an active account", async () => {
    const { editor } = harness(() => ({ status: "absent" }), { publicKey: "" });
    await expect(editor.readMailboxes()).rejects.toThrow("signed-out");
    await expect(editor.addMailboxRelay("wss://a.test")).rejects.toThrow("signed-out");
  });
});
