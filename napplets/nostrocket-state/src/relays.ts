import type { NostrEvent } from "./state";

export type RelayCandidate = { url: string; monitors: number; medianReadRtt: number };

function normalizedRelay(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch (error) {
    console.warn("NIP-66 relay URL could not be normalized", { value, error });
    return undefined;
  }
}

export function selectNip66Relays(events: NostrEvent[], limit = 3): RelayCandidate[] {
  const observations = new Map<string, { monitors: Set<string>; rtts: number[] }>();
  for (const event of events) {
    if (event.kind !== 30166 || !event.tags.some((tag) => tag[0] === "n" && tag[1] === "clearnet")) continue;
    const url = normalizedRelay(event.tags.find((tag) => tag[0] === "d")?.[1] ?? "");
    if (!url) continue;
    if (event.tags.some((tag) => tag[0] === "R" && ["payment", "auth"].includes(tag[1]))) continue;
    const readRtt = Number(event.tags.find((tag) => tag[0] === "rtt-read")?.[1]);
    if (!Number.isFinite(readRtt) || readRtt < 0) continue;
    const record = observations.get(url) ?? { monitors: new Set<string>(), rtts: [] };
    if (!record.monitors.has(event.pubkey)) { record.monitors.add(event.pubkey); record.rtts.push(readRtt); }
    observations.set(url, record);
  }
  return [...observations].map(([url, record]) => ({ url, monitors: record.monitors.size, medianReadRtt: [...record.rtts].sort((a, b) => a - b)[Math.floor(record.rtts.length / 2)] }))
    .sort((a, b) => b.monitors - a.monitors || a.medianReadRtt - b.medianReadRtt || a.url.localeCompare(b.url)).slice(0, limit);
}
