export type RelayContext = "discovery" | "read" | "write" | "explicit" | "auth";

export interface RelayPolicyOptions {
  readonly allowInsecureLocalhost?: boolean;
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
  readonly maximumRelays?: number;
}

export class RelayPolicy {
  readonly maximumRelays: number;
  readonly #allowInsecureLocalhost: boolean;
  readonly #allow: Set<string> | undefined;
  readonly #deny: Set<string>;

  constructor(options: RelayPolicyOptions = {}) {
    this.maximumRelays = options.maximumRelays ?? 10;
    this.#allowInsecureLocalhost = options.allowInsecureLocalhost ?? false;
    this.#allow = options.allow ? new Set(options.allow.map((url) => this.normalizeUnchecked(url))) : undefined;
    this.#deny = new Set((options.deny ?? []).map((url) => this.normalizeUnchecked(url)));
  }

  normalize(raw: string, _context: RelayContext): string {
    const normalized = this.normalizeUnchecked(raw);
    if (this.#deny.has(normalized)) throw new Error("Relay denied by policy");
    if (this.#allow && !this.#allow.has(normalized)) throw new Error("Relay absent from allow list");
    return normalized;
  }

  select(urls: readonly string[], context: RelayContext): string[] {
    const selected = [...new Set(urls.map((url) => this.normalize(url, context)))];
    if (selected.length > this.maximumRelays) throw new Error(`Relay limit exceeded: ${this.maximumRelays}`);
    return selected;
  }

  private normalizeUnchecked(raw: string): string {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("Malformed relay URL"); }
    if (url.username || url.password) throw new Error("Relay URL credentials forbidden");
    if (url.hash) throw new Error("Relay URL fragment forbidden");
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && local && this.#allowInsecureLocalhost)) throw new Error("Relay scheme forbidden");
    url.search = ""; url.hash = "";
    if ((url.protocol === "wss:" && url.port === "443") || (url.protocol === "ws:" && url.port === "80")) url.port = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  }
}
