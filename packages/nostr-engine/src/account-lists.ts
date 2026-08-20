import { MailboxesFactory } from "applesauce-core/factories";
import { BlossomServerListFactory } from "applesauce-common/factories/blossom-server-list";
import { BLOSSOM_SERVER_LIST_KIND, getBlossomServersFromList, normalizeBlossomServer } from "applesauce-common/helpers/blossom";
import { getInboxes, getOutboxes, kinds } from "applesauce-core/helpers";
import type { EventTemplate, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import type { EventSigner } from "applesauce-core/factories/types";
import type { AccountController } from "./accounts.js";
import type { RelayPolicy } from "./relay-policy.js";
import type { RelayPublisher } from "./relay-publish.js";

export const MAILBOX_LIST_KIND = kinds.RelayList;
export { BLOSSOM_SERVER_LIST_KIND };

/** Which side of a NIP-65 mailbox list an edit applies to. */
export type MailboxSide = "inbox" | "outbox" | "both";

/** Normalizes a Blossom server URL, throwing when it is not usable. */
export const normalizeMediaServer = (url: string): string => normalizeBlossomServer(url.trim()).toString();

/**
 * The outcome of looking up an existing replaceable event.
 *
 * "absent" and "unavailable" must stay distinct: rebuilding a replaceable list from scratch after a
 * failed lookup would publish a newer event that silently replaces the user's real list.
 */
export type ReplaceableLookup =
  | { readonly status: "found"; readonly event: NostrEvent }
  | { readonly status: "absent" }
  | { readonly status: "unavailable"; readonly reason?: string };

export interface Mailboxes {
  readonly inboxes: readonly string[];
  readonly outboxes: readonly string[];
  readonly event?: NostrEvent;
}

export interface BlossomServerList {
  readonly servers: readonly string[];
  readonly event?: NostrEvent;
}

export interface AccountListEditor {
  readMailboxes(pubkey?: string): Promise<Mailboxes>;
  addMailboxRelay(url: string, side?: MailboxSide): Promise<NostrEvent>;
  removeMailboxRelay(url: string, side?: MailboxSide): Promise<NostrEvent>;
  readBlossomServers(pubkey?: string): Promise<BlossomServerList>;
  addBlossomServer(url: string): Promise<NostrEvent>;
  removeBlossomServer(url: string): Promise<NostrEvent>;
}

/** The slice of the engine this editor needs, kept narrow so it can be unit tested without a pool. */
export interface AccountListEngine {
  readonly accounts: Pick<AccountController, "publicKey" | "sign">;
  readonly relayPolicy: RelayPolicy;
}

export interface AccountListEditorOptions {
  readonly publisher: RelayPublisher;
  /** Resolves the account's current replaceable event, distinguishing "none published" from "lookup failed". */
  readonly lookup: (kind: number, pubkey: string) => Promise<ReplaceableLookup>;
  /**
   * Relays a freshly signed list should be published to. Receives the previous version too, so the
   * shell can also reach relays that are being removed and would otherwise keep serving a stale list.
   */
  readonly publishRelays: (kind: number, event: NostrEvent, previous?: NostrEvent) => readonly string[];
}

/**
 * Relays a NIP-65 update should reach: the outboxes it now names, the outboxes the previous version
 * named (so a relay being dropped stops serving the stale list), plus the caller's own targets.
 */
export function relayListPublishTargets(event: NostrEvent, previous: NostrEvent | undefined, extra: readonly string[]): string[] {
  return [...new Set([...extra, ...getOutboxes(event), ...(previous ? getOutboxes(previous) : [])])];
}

const signedOut = (): Error => new Error("signed-out");
const asKnown = <K extends number>(event: NostrEvent, kind: K): KnownEvent<K> => {
  if (event.kind !== kind) throw new Error(`expected kind ${kind}, received ${event.kind}`);
  return event as KnownEvent<K>;
};

export function createAccountListEditor(engine: AccountListEngine, options: AccountListEditorOptions): AccountListEditor {
  const signer: EventSigner = {
    getPublicKey: () => engine.accounts.publicKey,
    // Routed through the account controller so event limits and the active-account guard still apply.
    signEvent: (draft) => engine.accounts.sign(draft as EventTemplate)
  };

  const requirePubkey = (): string => {
    const pubkey = engine.accounts.publicKey;
    if (!pubkey) throw signedOut();
    return pubkey;
  };

  const current = async (kind: number, allowCreate: boolean): Promise<NostrEvent | undefined> => {
    const result = await options.lookup(kind, requirePubkey());
    if (result.status === "unavailable") throw new Error(result.reason ?? "list-unavailable");
    if (result.status === "found") return result.event;
    if (!allowCreate) throw new Error("list-not-published");
    return undefined;
  };

  const publish = async (kind: number, signed: NostrEvent, previous?: NostrEvent): Promise<NostrEvent> => {
    const relays = options.publishRelays(kind, signed, previous);
    if (relays.length === 0) throw new Error("no-publish-relays");
    const result = await options.publisher.publishSigned(relays, signed);
    return result.event;
  };

  const normalizeRelay = (url: string): string => engine.relayPolicy.normalize(url.trim(), "write");
  const normalizeServer = (url: string): string => normalizeBlossomServer(url.trim()).toString();

  const readMailboxes = async (pubkey?: string): Promise<Mailboxes> => {
    const result = await options.lookup(MAILBOX_LIST_KIND, pubkey ?? requirePubkey());
    if (result.status !== "found") return { inboxes: [], outboxes: [] };
    return { inboxes: getInboxes(result.event), outboxes: getOutboxes(result.event), event: result.event };
  };

  const readBlossomServers = async (pubkey?: string): Promise<BlossomServerList> => {
    const result = await options.lookup(BLOSSOM_SERVER_LIST_KIND, pubkey ?? requirePubkey());
    if (result.status !== "found") return { servers: [] };
    return { servers: getBlossomServersFromList(result.event).map((server) => server.toString()), event: result.event };
  };

  /** Rejects an addition that would push the account past the relay budget the platform will connect to. */
  const guardRelayBudget = (existing: Mailboxes, added: string): void => {
    engine.relayPolicy.select([...existing.inboxes, ...existing.outboxes, added], "write");
  };

  const mailboxFactory = (event: NostrEvent | undefined): MailboxesFactory =>
    event ? MailboxesFactory.modify(asKnown(event, MAILBOX_LIST_KIND)) : MailboxesFactory.create();

  const applySide = (factory: MailboxesFactory, url: string, side: MailboxSide, remove: boolean): MailboxesFactory => {
    if (side === "both") return remove ? factory.removeRelay(url) : factory.addRelay(url);
    if (side === "inbox") return remove ? factory.removeInbox(url) : factory.addInbox(url);
    return remove ? factory.removeOutbox(url) : factory.addOutbox(url);
  };

  return {
    readMailboxes,
    readBlossomServers,

    async addMailboxRelay(url, side = "both") {
      const normalized = normalizeRelay(url);
      const existing = await current(MAILBOX_LIST_KIND, true);
      guardRelayBudget(
        existing ? { inboxes: getInboxes(existing), outboxes: getOutboxes(existing) } : { inboxes: [], outboxes: [] },
        normalized
      );
      const signed = await applySide(mailboxFactory(existing), normalized, side, false).sign(signer);
      return publish(MAILBOX_LIST_KIND, signed, existing);
    },

    async removeMailboxRelay(url, side = "both") {
      const normalized = normalizeRelay(url);
      const existing = await current(MAILBOX_LIST_KIND, false);
      const signed = await applySide(mailboxFactory(existing), normalized, side, true).sign(signer);
      return publish(MAILBOX_LIST_KIND, signed, existing);
    },

    async addBlossomServer(url) {
      const normalized = normalizeServer(url);
      const existing = await current(BLOSSOM_SERVER_LIST_KIND, true);
      const factory = existing ? BlossomServerListFactory.modify(existing) : BlossomServerListFactory.create();
      const signed = await factory.addServer(normalized).sign(signer);
      return publish(BLOSSOM_SERVER_LIST_KIND, signed, existing);
    },

    async removeBlossomServer(url) {
      const normalized = normalizeServer(url);
      const existing = await current(BLOSSOM_SERVER_LIST_KIND, false);
      const factory = existing ? BlossomServerListFactory.modify(existing) : BlossomServerListFactory.create();
      const signed = await factory.removeServer(normalized).sign(signer);
      return publish(BLOSSOM_SERVER_LIST_KIND, signed, existing);
    }
  };
}
