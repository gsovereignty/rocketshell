export type RelayContext = "discovery" | "read" | "write" | "explicit" | "auth";

export interface RelayPolicyOptions {
  readonly allowInsecureLocalhost?: boolean;
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  readonly maximumRelays?: number;
}

export interface RelayPolicy {
  readonly maximumRelays: number;
  normalize(raw: string, context: RelayContext): string;
  select(urls: readonly string[], context: RelayContext): string[];
}

export function createRelayPolicy(options: RelayPolicyOptions = {}): RelayPolicy {
  const maximumRelays = options.maximumRelays ?? 10;
  const allowInsecureLocalhost = options.allowInsecureLocalhost ?? false;
  const normalizeUnchecked = (raw: string): string => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("Malformed relay URL"); }
    if (url.username || url.password) throw new Error("Relay URL credentials forbidden");
    if (url.hash) throw new Error("Relay URL fragment forbidden");
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && local && allowInsecureLocalhost)) throw new Error("Relay scheme forbidden");
    url.search = ""; url.hash = "";
    if ((url.protocol === "wss:" && url.port === "443") || (url.protocol === "ws:" && url.port === "80")) url.port = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  };
  const allow = options.allow ? new Set(options.allow.map(normalizeUnchecked)) : undefined;
  const deny = new Set((options.deny ?? []).map(normalizeUnchecked));
  const normalize = (raw: string, _context: RelayContext): string => {
    const normalized = normalizeUnchecked(raw);
    if (deny.has(normalized)) throw new Error("Relay denied by policy");
    if (allow && !allow.has(normalized)) throw new Error("Relay absent from allow list");
    return normalized;
  };
  return {
    maximumRelays,
    normalize,
    select(urls, context) {
      const selected = [...new Set(urls.map((url) => normalize(url, context)))];
      if (selected.length > maximumRelays) throw new Error(`Relay limit exceeded: ${maximumRelays}`);
      return selected;
    }
  };
}
