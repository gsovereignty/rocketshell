import type { NostrEvent } from "@napplet/sdk";

export const NOSTROCKET_AUTHOR = "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075";
export const NOSTROCKET_COORDINATE = `31108:${NOSTROCKET_AUTHOR}:NOSTROCKET`;

export interface RocketOption {
  coordinate: string;
  name: string;
  author: string;
  event?: NostrEvent;
}

const PUBKEY = /^[0-9a-f]{64}$/;

export function rocketsFromEvents(events: NostrEvent[]): RocketOption[] {
  const latest = new Map<string, RocketOption>();
  for (const event of events) {
    if (event.kind !== 31108 || !PUBKEY.test(event.pubkey)) continue;
    const name = event.tags.find((tag) => tag[0] === "d")?.[1]?.trim();
    if (!name) continue;
    const coordinate = `31108:${event.pubkey}:${name}`;
    const current = latest.get(coordinate)?.event;
    if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id > current.id)) {
      latest.set(coordinate, { coordinate, name, author: event.pubkey, event });
    }
  }
  if (!latest.has(NOSTROCKET_COORDINATE)) {
    latest.set(NOSTROCKET_COORDINATE, {
      coordinate: NOSTROCKET_COORDINATE,
      name: "NOSTROCKET",
      author: NOSTROCKET_AUTHOR
    });
  }
  return [...latest.values()].sort((left, right) => {
    if (left.coordinate === NOSTROCKET_COORDINATE) return -1;
    if (right.coordinate === NOSTROCKET_COORDINATE) return 1;
    return left.name.localeCompare(right.name) || left.coordinate.localeCompare(right.coordinate);
  });
}

export interface RocketProfile { name?: string; picture?: string }

export function profilesFromEvents(events: NostrEvent[]): Map<string, RocketProfile> {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== 0 || !PUBKEY.test(event.pubkey)) continue;
    const current = latest.get(event.pubkey);
    if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id > current.id)) latest.set(event.pubkey, event);
  }
  const profiles = new Map<string, RocketProfile>();
  for (const [author, event] of latest) {
    try {
      const value = JSON.parse(event.content) as Record<string, unknown>;
      profiles.set(author, {
        name: typeof value.display_name === "string" ? value.display_name : typeof value.name === "string" ? value.name : undefined,
        picture: typeof value.picture === "string" ? value.picture : undefined
      });
    } catch (error) {
      console.warn("Rocket author profile could not be parsed", { author, eventId: event.id, error });
    }
  }
  return profiles;
}

export function avatarLabel(name: string): string {
  const words = name.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "R").toUpperCase();
}
