import { aggregateMeritHoldings, firstTag, type NostrEvent } from "./state";

export type PendingMeritRequest = { id: string; requester: string; merits: bigint; problem: string; createdAt: number };
const HEX_64 = /^[0-9a-f]{64}$/;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

export function pendingMeritRequests(events: NostrEvent[], state: NostrEvent, coordinate: string): PendingMeritRequest[] {
  const approved = new Set(aggregateMeritHoldings(state).flatMap(({ lots }) => lots.map(({ requestId }) => requestId)));
  const requests = new Map<string, PendingMeritRequest>();
  for (const event of events) {
    if (event.kind !== 1409 || !HEX_64.test(event.id) || !HEX_64.test(event.pubkey) || approved.has(event.id)) continue;
    if (!event.tags.some((tag) => tag[0] === "a" && tag[1] === coordinate)) continue;
    const value = firstTag(event, "merits") ?? firstTag(event, "sats");
    if (!UNSIGNED_INTEGER.test(value ?? "")) {
      console.warn("Pending merit request ignored because amount is invalid", { eventId: event.id });
      continue;
    }
    requests.set(event.id, { id: event.id, requester: event.pubkey, merits: BigInt(value!), problem: event.tags.find(([name]) => name === "problem")?.[2]?.trim() || "Problem not specified", createdAt: event.created_at });
  }
  return [...requests.values()].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}
