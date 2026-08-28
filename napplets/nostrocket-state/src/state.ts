import { parseRocketCoordinate } from "./coordinates";

export type NostrEvent = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };

export type MeritLot = { owner: string; requestId: string; leadTime: bigint; lastLeadTimeUpdate: bigint; merits: bigint };
export type MeritHolding = { owner: string; merits: bigint; lots: MeritLot[] };

const HEX_64 = /^[0-9a-f]{64}$/;
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

export function parseMeritTag(tag: string[]): MeritLot {
  if (tag[0] !== "merit" || tag.length !== 2) throw new Error("Merit tag must contain one encoded value.");
  const [owner, requestId, leadTime, lastLeadTimeUpdate, merits, extra] = tag[1].split(":");
  if (extra !== undefined || !HEX_64.test(owner ?? "") || !HEX_64.test(requestId ?? "")) throw new Error("Merit tag has invalid owner or request ID.");
  if (![leadTime, lastLeadTimeUpdate, merits].every((value) => UNSIGNED_INTEGER.test(value ?? ""))) throw new Error("Merit tag numeric fields must be unsigned integers.");
  return { owner, requestId, leadTime: BigInt(leadTime), lastLeadTimeUpdate: BigInt(lastLeadTimeUpdate), merits: BigInt(merits) };
}

export function aggregateMeritHoldings(event: NostrEvent): MeritHolding[] {
  const byOwner = new Map<string, MeritHolding>();
  for (const tag of event.tags.filter(([name]) => name === "merit")) {
    const lot = parseMeritTag(tag);
    const holding = byOwner.get(lot.owner) ?? { owner: lot.owner, merits: 0n, lots: [] };
    if (holding.lots.some(({ requestId }) => requestId === lot.requestId)) throw new Error(`Duplicate merit request ${lot.requestId}.`);
    holding.merits += lot.merits;
    holding.lots.push(lot);
    byOwner.set(lot.owner, holding);
  }
  return [...byOwner.values()].sort((a, b) => a.merits === b.merits ? a.owner.localeCompare(b.owner) : a.merits > b.merits ? -1 : 1);
}

export function validateStateEvent(event: NostrEvent, coordinate = "31108:d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075:NOSTROCKET"): void {
  const { author, identifier } = parseRocketCoordinate(coordinate);
  if (event.kind !== 31108) throw new Error("Unexpected event kind.");
  if (event.pubkey !== author) throw new Error("Unexpected state author.");
  if (!event.tags.some((tag) => tag[0] === "d" && tag[1] === identifier)) throw new Error("Unexpected rocket identifier.");
  if (!HEX_64.test(event.id) || !HEX_64.test(event.sig.slice(0, 64)) || event.sig.length !== 128) throw new Error("Malformed event identity or signature.");
  aggregateMeritHoldings(event);
}

export function firstTag(event: NostrEvent, name: string): string | undefined { return event.tags.find((tag) => tag[0] === name)?.[1]; }
