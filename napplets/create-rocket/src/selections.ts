export interface ChoiceEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

export interface ChoiceResult {
  event: ChoiceEvent;
  sidecar?: { relayHints?: string[] };
}

export interface RocketReferenceChoice {
  coordinate: string;
  relay: string;
  title: string;
  summary: string;
  createdAt: number;
}

const HEX_64 = /^[0-9a-f]{64}$/;

function tag(event: ChoiceEvent, name: string, marker?: string): string[] | undefined {
  return event.tags.find((item) => item[0] === name && (marker === undefined || item[3] === marker));
}

function isRelayHint(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch (error) {
    console.warn("Rocket reference relay hint validation failed", { value, error });
    return false;
  }
}

function relayHint(result: ChoiceResult, eventHint: string | undefined, fallbackRelays: readonly string[]): string {
  return result.sidecar?.relayHints?.find(isRelayHint)
    ?? (isRelayHint(eventHint) ? eventHint : undefined)
    ?? fallbackRelays.find(isRelayHint)
    ?? "";
}

function newest(results: ChoiceResult[]): ChoiceResult {
  return [...results].sort((left, right) =>
    right.event.created_at - left.event.created_at || right.event.id.localeCompare(left.event.id))[0]!;
}

function problemHead(results: ChoiceResult[]): ChoiceResult {
  const referenced = new Set(results.flatMap(({ event }) => event.tags
    .filter((item) => item[0] === "e" && item[3] === "previous")
    .map((item) => item[1])
    .filter((id): id is string => Boolean(id))));
  const heads = results.filter(({ event }) => !referenced.has(event.id));
  return newest(heads.length ? heads : results);
}

function excerpt(value: string, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return fallback;
  return [...normalized].slice(0, 180).join("");
}

export function problemChoices(results: readonly ChoiceResult[], pubkey: string, fallbackRelays: readonly string[] = []): RocketReferenceChoice[] {
  const groups = new Map<string, ChoiceResult[]>();
  for (const result of results) {
    const { event } = result;
    const problemId = tag(event, "d")?.[1]?.trim();
    if (event.kind !== 31971 || event.pubkey !== pubkey || !problemId || !HEX_64.test(problemId)) continue;
    const coordinate = `31971:${pubkey}:${problemId}`;
    if (tag(event, "a", "origin")?.[1] !== coordinate) continue;
    const group = groups.get(problemId) ?? [];
    group.push(result);
    groups.set(problemId, group);
  }

  return [...groups.entries()].map(([problemId, group]) => {
    const current = problemHead(group);
    const coordinate = `31971:${pubkey}:${problemId}`;
    const title = tag(current.event, "title")?.[1]?.trim() || excerpt(current.event.content, "Untitled problem");
    return {
      coordinate,
      relay: relayHint(current, tag(current.event, "a", "origin")?.[2], fallbackRelays),
      title,
      summary: excerpt(current.event.content, "No problem description."),
      createdAt: current.event.created_at
    };
  }).sort((left, right) => right.createdAt - left.createdAt || left.title.localeCompare(right.title));
}

export function repositoryChoices(results: readonly ChoiceResult[], pubkey: string, fallbackRelays: readonly string[] = []): RocketReferenceChoice[] {
  const groups = new Map<string, ChoiceResult[]>();
  for (const result of results) {
    const { event } = result;
    const identifier = tag(event, "d")?.[1]?.trim();
    if (event.kind !== 30617 || event.pubkey !== pubkey || !identifier) continue;
    const group = groups.get(identifier) ?? [];
    group.push(result);
    groups.set(identifier, group);
  }

  return [...groups.entries()].map(([identifier, group]) => {
    const current = newest(group);
    return {
      coordinate: `30617:${pubkey}:${identifier}`,
      relay: relayHint(current, undefined, fallbackRelays),
      title: tag(current.event, "name")?.[1]?.trim() || identifier,
      summary: excerpt(tag(current.event, "description")?.[1] ?? "", "No repository description."),
      createdAt: current.event.created_at
    };
  }).sort((left, right) => right.createdAt - left.createdAt || left.title.localeCompare(right.title));
}
