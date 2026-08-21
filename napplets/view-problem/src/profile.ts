export interface ProfileData {
  name: string;
  picture?: string;
}

interface MetadataEvent {
  pubkey: string;
  created_at: number;
  content: string;
}

const nonEmptyString = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

export function profileFromEvents(pubkey: string, events: MetadataEvent[]): ProfileData | undefined {
  const metadata = events
    .filter((event) => event.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at);

  for (const event of metadata) {
    try {
      const content = JSON.parse(event.content) as Record<string, unknown>;
      const name = nonEmptyString(content.display_name) ?? nonEmptyString(content.name) ?? nonEmptyString(content.nip05);
      const picture = nonEmptyString(content.picture);
      if (name || picture) return { name: name ?? pubkey, picture };
    } catch (error) {
      console.warn("Ignoring malformed profile metadata", { pubkey, createdAt: event.created_at, error });
    }
  }
  return undefined;
}
