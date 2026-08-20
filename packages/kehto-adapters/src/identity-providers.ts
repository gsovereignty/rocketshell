import { kinds, type NostrEvent } from "applesauce-core/helpers";
import {
  getBadgeAwardPointer, getBadgeDescription, getBadgeImage, getBadgeName, getBadgeThumbnails,
  getZapAmount, getZapRequest, getZapSender
} from "applesauce-common/helpers";
import { castUser, type Profile } from "applesauce-common/casts";
import { EMPTY, catchError, defaultIfEmpty, firstValueFrom, lastValueFrom, timeout } from "rxjs";
import type { ReplaceableLookup } from "@platform/nostr-engine";
import { eventLoader, eventStore, relayPolicy, relayPool } from "@platform/nostr-engine";
import type { Badge, ProfileData, RelayPermission, ZapReceipt } from "@napplet/nap/identity";

const LOAD_TIMEOUT_MS = 16_000;
const GENERIC_LIST_KIND = 30_001;
const BLOCK_LIST_KIND = 30_000;
const BLOCK_LIST_IDENTIFIER = "blocked";
const LIST_KINDS: Readonly<Record<string, number>> = Object.freeze({
  pins: 10_001,
  bookmarks: 10_003,
  communities: 10_004,
  "public-chats": 10_005,
  interests: 10_015
});
const LIST_METADATA_TAGS = new Set(["d", "title", "name", "description", "summary", "image"]);

export interface IdentityProviders {
  getRelays(pubkey: string): Promise<Record<string, RelayPermission>>;
  getProfile(pubkey: string): Promise<ProfileData | null>;
  getFollows(pubkey: string): Promise<string[]>;
  getList(type: string, pubkey: string): Promise<string[]>;
  getZaps(pubkey: string): Promise<ZapReceipt[]>;
  getMutes(pubkey: string): Promise<string[]>;
  getBlocked(pubkey: string): Promise<string[]>;
  getBadges(pubkey: string): Promise<Badge[]>;
  /**
   * Resolves a replaceable event, reporting whether it is genuinely unpublished or merely
   * unreachable. Editors of replaceable lists must not treat the two the same.
   */
  lookupReplaceable(kind: number, pubkey: string, options?: LookupOptions): Promise<ReplaceableLookup>;
}

export interface LookupOptions {
  /** Skip the local event store and always ask the network for the newest version. */
  readonly refresh?: boolean;
  readonly hints?: readonly string[];
}

const toProfile = (profile: Profile | undefined): ProfileData | null => {
  if (!profile) return null;
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.about ? { about: profile.about } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    ...(profile.banner ? { banner: profile.banner } : {}),
    ...(profile.dnsIdentity ? { nip05: profile.dnsIdentity } : {}),
    ...(profile.lud16 ? { lud16: profile.lud16 } : {}),
    ...(profile.website ? { website: profile.website } : {})
  };
};

const publicPubkeys = (event: NostrEvent | undefined): string[] => event
  ? [...new Set(event.tags.flatMap((tag) => tag[0] === "p" && typeof tag[1] === "string" && /^[0-9a-f]{64}$/i.test(tag[1]) ? [tag[1]] : []))]
  : [];

const listEntries = (event: NostrEvent | undefined): string[] => event
  ? [...new Set(event.tags.flatMap((tag) => typeof tag[0] === "string" && !LIST_METADATA_TAGS.has(tag[0]) && typeof tag[1] === "string" && tag[1].length > 0 ? [tag[1]] : []))]
  : [];

/**
 * `relayUrls` is read on every request rather than copied, so passing the live tier arrays from
 * {@link createRelayConfiguration} keeps the direct queries current as settings change.
 *
 * Replaceable lookups go through the shared {@link eventLoader}, whose relays are observables and
 * therefore already follow both the account's own lists and the settings panel.
 */
export function createIdentityProviders(relayUrls: string[]): IdentityProviders {


  const lookupReplaceable = async (kind: number, pubkey: string, lookup: LookupOptions = {}): Promise<ReplaceableLookup> => {
    const stored = (): NostrEvent | undefined => eventStore.getReplaceable(kind, pubkey);
    if (!pubkey) return { status: "unavailable", reason: "signed-out" };
    const cached = stored();
    if (cached && !lookup.refresh) return { status: "found", event: cached };
    if (relayUrls.length === 0) return { status: "unavailable", reason: "no-relays-configured" };
    try {
      const event = await firstValueFrom(eventLoader({ kind, pubkey, relays: [...(lookup.hints ?? [])] }).pipe(
        timeout({ first: LOAD_TIMEOUT_MS }), defaultIfEmpty(undefined)
      ));
      const resolved = event ?? stored();
      // Completing without an event means the relays answered EOSE with nothing: genuinely unpublished.
      return resolved ? { status: "found", event: resolved } : { status: "absent" };
    } catch {
      const fallback = stored();
      return fallback ? { status: "found", event: fallback } : { status: "unavailable", reason: "relay-lookup-failed" };
    }
  };
  const resolve = async (kind: number, pubkey: string, identifier?: string, hints: readonly string[] = []): Promise<NostrEvent | undefined> => {
    const cached = eventStore.getReplaceable(kind, pubkey, identifier);
    if (cached || !pubkey || relayUrls.length === 0) return cached;
    try {
      const event = await firstValueFrom(eventLoader({ kind, pubkey, ...(identifier ? { identifier } : {}), relays: [...hints] }).pipe(
        timeout({ first: LOAD_TIMEOUT_MS }), defaultIfEmpty(undefined)
      ));
      return event ?? eventStore.getReplaceable(kind, pubkey, identifier);
    } catch {
      return eventStore.getReplaceable(kind, pubkey, identifier);
    }
  };
  const query = async (filter: Parameters<typeof eventStore.getByFilters>[0]): Promise<NostrEvent[]> => {
    const cached = eventStore.getByFilters(filter);
    if (cached.length > 0 || relayUrls.length === 0) return cached;
    // The request completes on EOSE and writes through the store's verifier on the way.
    await lastValueFrom(relayPool.request(relayPolicy.select(relayUrls, "read"), filter, {
      eventStore, timeout: LOAD_TIMEOUT_MS
    }).pipe(catchError(() => EMPTY), defaultIfEmpty(undefined)));
    return eventStore.getByFilters(filter);
  };

  /** Casts read straight from the shared store and resolve missing events through its loader. */
  const user = (pubkey: string) => castUser(pubkey, eventStore);
  return {
    lookupReplaceable: (kind, pubkey, lookup) => lookupReplaceable(kind, pubkey, lookup ?? {}),
    getRelays: async (pubkey) => {
      if (!pubkey) return {};
      const mailboxes = await user(pubkey).mailboxes$.$first(LOAD_TIMEOUT_MS, undefined);
      if (!mailboxes) return {};
      const inboxes = new Set(mailboxes.inboxes);
      const outboxes = new Set(mailboxes.outboxes);
      return Object.fromEntries([...new Set([...inboxes, ...outboxes])].map((url) => [url, {
        read: inboxes.has(url), write: outboxes.has(url)
      }]));
    },
    getProfile: async (pubkey) => pubkey ? toProfile(await user(pubkey).profile$.$first(LOAD_TIMEOUT_MS, undefined)) : null,
    getFollows: async (pubkey) => {
      if (!pubkey) return [];
      const contacts = await user(pubkey).contacts$.$first(LOAD_TIMEOUT_MS, []);
      return [...new Set(contacts.map((contact) => contact.pubkey))];
    },
    getList: async (type, pubkey) => {
      const normalized = type.trim().toLowerCase();
      if (!normalized) return [];
      const standardKind = LIST_KINDS[normalized];
      const event = standardKind
        ? await resolve(standardKind, pubkey)
        : await resolve(GENERIC_LIST_KIND, pubkey, normalized);
      return listEntries(event);
    },
    getZaps: async (pubkey) => {
      const events = await query({ kinds: [kinds.Zap], "#p": [pubkey] });
      return events.flatMap((event): ZapReceipt[] => {
        const sender = getZapSender(event);
        const amount = getZapAmount(event);
        if (!sender || amount === undefined || !Number.isSafeInteger(amount) || amount < 0) return [];
        const content = getZapRequest(event)?.content.trim();
        return [{ eventId: event.id, sender, amount, ...(content ? { content } : {}) }];
      }).sort((a, b) => a.eventId.localeCompare(b.eventId));
    },
    getMutes: async (pubkey) => {
      if (!pubkey) return [];
      const mutes = await user(pubkey).mutes$.$first(LOAD_TIMEOUT_MS, undefined);
      return mutes ? [...mutes.pubkeys] : [];
    },
    getBlocked: async (pubkey) => publicPubkeys(await resolve(BLOCK_LIST_KIND, pubkey, BLOCK_LIST_IDENTIFIER)),
    getBadges: async (pubkey) => {
      const awards = await query({ kinds: [kinds.BadgeAward], "#p": [pubkey] });
      const badges = await Promise.all(awards.map(async (award): Promise<Badge | undefined> => {
        const pointer = getBadgeAwardPointer(award);
        if (!pointer) return undefined;
        const definition = await resolve(pointer.kind, pointer.pubkey, pointer.identifier, pointer.relays);
        if (!definition) return undefined;
        const name = getBadgeName(definition);
        const description = getBadgeDescription(definition);
        const image = getBadgeImage(definition)?.url;
        const thumbs = getBadgeThumbnails(definition).map((thumb) => thumb.url);
        return {
          id: `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`,
          ...(name ? { name } : {}),
          ...(description ? { description } : {}),
          ...(image ? { image } : {}),
          ...(thumbs.length ? { thumbs } : {}),
          awardedBy: award.pubkey
        };
      }));
      const unique = new Map<string, Badge>();
      for (const badge of badges) if (badge) unique.set(`${badge.id}\0${badge.awardedBy}`, badge);
      return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id) || a.awardedBy.localeCompare(b.awardedBy));
    }
  };
}
