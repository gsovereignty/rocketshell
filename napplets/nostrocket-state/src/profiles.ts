import type { NostrEvent } from "./state";

export type HolderProfile = { name?: string; picture?: string };

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export function holderProfilesFromEvents(authors: string[], events: NostrEvent[]): Map<string, HolderProfile> {
  const wanted = new Set(authors);
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== 0 || !wanted.has(event.pubkey)) continue;
    const current = latest.get(event.pubkey);
    if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id < current.id)) {
      latest.set(event.pubkey, event);
    }
  }

  const profiles = new Map<string, HolderProfile>();
  for (const [author, event] of latest) {
    try {
      const content = JSON.parse(event.content) as Record<string, unknown>;
      const name = nonEmptyString(content.display_name) ?? nonEmptyString(content.name) ?? nonEmptyString(content.nip05);
      const picture = nonEmptyString(content.picture);
      if (name || picture) profiles.set(author, { name, picture });
    } catch (error) {
      console.warn("Ignoring malformed holder profile metadata", { author, eventId: event.id, error });
    }
  }
  return profiles;
}

export function avatarLabel(name: string | undefined, pubkey: string): string {
  const words = name?.trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean) ?? [];
  const label = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) ?? pubkey.slice(0, 2);
  return label.toUpperCase().padEnd(2, "?");
}

export function avatarHue(pubkey: string): number {
  return Array.from(pubkey).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) % 360, 0);
}
