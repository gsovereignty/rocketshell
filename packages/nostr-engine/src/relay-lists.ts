import type { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { EventIngress } from "./event-ingress.js";
import type { RelayPolicy } from "./relay-policy.js";

const RELAY_LIST_KIND = 10002;
export interface RelayList { readonly read: readonly string[]; readonly write: readonly string[]; readonly event?: NostrEvent }
export type DirectRelayListQuery = (discoveryRelays: readonly string[], authors: readonly string[]) => Promise<readonly NostrEvent[]>;

interface CacheEntry { readonly value?: RelayList; readonly updatedAt: number }
export interface RelayListResolverOptions { readonly positiveFreshnessMs?: number; readonly negativeFreshnessMs?: number; readonly staleUsableMs?: number; readonly now?: () => number }

export class RelayListResolver {
  readonly #cache = new Map<string, CacheEntry>();
  readonly #positiveFreshness: number; readonly #negativeFreshness: number; readonly #staleUsable: number; readonly #now: () => number;
  constructor(private readonly store: EventStore, private readonly ingress: EventIngress, private readonly policy: RelayPolicy, private readonly discoveryRelays: readonly string[], private readonly directQuery: DirectRelayListQuery, options: RelayListResolverOptions = {}) {
    this.#positiveFreshness = options.positiveFreshnessMs ?? 15 * 60_000;
    this.#negativeFreshness = options.negativeFreshnessMs ?? 60_000;
    this.#staleUsable = options.staleUsableMs ?? 24 * 60 * 60_000;
    this.#now = options.now ?? Date.now;
  }

  async resolve(authors: readonly string[]): Promise<ReadonlyMap<string, RelayList | undefined>> {
    const now = this.#now(); const result = new Map<string, RelayList | undefined>(); const missing: string[] = [];
    for (const author of [...new Set(authors)]) {
      const cached = this.#cache.get(author); const freshness = cached?.value ? this.#positiveFreshness : this.#negativeFreshness;
      if (cached && now - cached.updatedAt <= freshness) result.set(author, cached.value);
      else {
        const stored = this.store.getReplaceable(RELAY_LIST_KIND, author);
        if (stored) {
          const storedAt = stored.created_at * 1_000; const parsed = this.parse(stored);
          this.#cache.set(author, { value: parsed, updatedAt: storedAt });
          if (now - storedAt <= this.#positiveFreshness) { result.set(author, parsed); continue; }
        }
        missing.push(author);
      }
    }
    if (missing.length) {
      const events = await this.directQuery(this.discoveryRelays, missing);
      for (const event of events) this.ingress.admit(event, this.discoveryRelays[0] ?? "discovery:unknown");
      for (const author of missing) {
        const winner = this.store.getReplaceable(RELAY_LIST_KIND, author);
        if (winner) { const parsed = this.parse(winner); this.#cache.set(author, { value: parsed, updatedAt: now }); result.set(author, parsed); }
        else {
          const stale = this.#cache.get(author);
          if (stale?.value && now - stale.updatedAt <= this.#staleUsable) result.set(author, stale.value);
          else { this.#cache.set(author, { updatedAt: now }); result.set(author, undefined); }
        }
      }
    }
    return result;
  }

  private parse(event: NostrEvent): RelayList {
    const read: string[] = []; const write: string[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "r" || !tag[1]) continue;
      const marker = tag[2]; const normalized = this.policy.normalize(tag[1], "discovery");
      if (marker !== "write") read.push(normalized);
      if (marker !== "read") write.push(normalized);
    }
    return { read: [...new Set(read)], write: [...new Set(write)], event };
  }
}
