import type { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { EventIngress } from "./event-ingress.js";
import type { RelayPolicy } from "./relay-policy.js";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

const RELAY_LIST_KIND = 10002;
export interface RelayList { readonly read: readonly string[]; readonly write: readonly string[]; readonly event?: NostrEvent }
export type DirectRelayListQuery = (discoveryRelays: readonly string[], authors: readonly string[]) => Promise<readonly NostrEvent[]>;
interface CacheEntry { readonly value?: RelayList; readonly updatedAt: number }
export interface RelayListResolverOptions { readonly positiveFreshnessMs?: number; readonly negativeFreshnessMs?: number; readonly staleUsableMs?: number; readonly now?: () => number; readonly telemetry?: PlatformTelemetry }
export interface RelayListResolver { resolve(authors: readonly string[]): Promise<ReadonlyMap<string, RelayList | undefined>> }

export function createRelayListResolver(store: EventStore, ingress: EventIngress, policy: RelayPolicy, discoveryRelays: readonly string[], directQuery: DirectRelayListQuery, options: RelayListResolverOptions = {}): RelayListResolver {
  const cache = new Map<string, CacheEntry>();
  const positiveFreshness = options.positiveFreshnessMs ?? 15 * 60_000;
  const negativeFreshness = options.negativeFreshnessMs ?? 60_000;
  const staleUsable = options.staleUsableMs ?? 24 * 60 * 60_000;
  const currentTime = options.now ?? Date.now;
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const parse = (event: NostrEvent): RelayList => {
    const read: string[] = []; const write: string[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "r" || !tag[1]) continue;
      const marker = tag[2]; let normalized: string;
      try { normalized = policy.normalize(tag[1], "discovery"); } catch { continue; }
      if (marker !== "write") read.push(normalized);
      if (marker !== "read") write.push(normalized);
    }
    return { read: [...new Set(read)], write: [...new Set(write)], event };
  };
  return { async resolve(authors) {
    const now = currentTime(); const result = new Map<string, RelayList | undefined>(); const missing: string[] = [];
    for (const author of [...new Set(authors)]) {
      const cached = cache.get(author); const freshness = cached?.value ? positiveFreshness : negativeFreshness;
      if (cached && now - cached.updatedAt <= freshness) {
        telemetry.record("relay-list.hit", 1, { result: cached.value ? "positive" : "negative" });
        if (!cached.value) telemetry.record("relay-list.negative", 1);
        result.set(author, cached.value);
      }
      else {
        const stored = store.getReplaceable(RELAY_LIST_KIND, author);
        if (stored) {
          const storedAt = stored.created_at * 1_000; const parsed = parse(stored);
          cache.set(author, { value: parsed, updatedAt: storedAt });
          if (now - storedAt <= positiveFreshness) { telemetry.record("relay-list.hit", 1, { result: "stored" }); result.set(author, parsed); continue; }
        }
        telemetry.record("relay-list.miss", 1);
        missing.push(author);
      }
    }
    if (missing.length) {
      const events = await directQuery(discoveryRelays, missing);
      for (const event of events) ingress.admit(event, discoveryRelays[0] ?? "discovery:unknown");
      for (const author of missing) {
        const winner = store.getReplaceable(RELAY_LIST_KIND, author);
        if (winner && now - winner.created_at * 1_000 <= positiveFreshness) {
          const parsed = parse(winner); cache.set(author, { value: parsed, updatedAt: now }); result.set(author, parsed);
        } else {
          const stale = cache.get(author);
          if (stale?.value && now - stale.updatedAt <= staleUsable) { telemetry.record("relay-list.stale", 1); result.set(author, stale.value); }
          else { telemetry.record("relay-list.negative", 1); cache.set(author, { updatedAt: now }); result.set(author, undefined); }
        }
      }
    }
    return result;
  } };
}
