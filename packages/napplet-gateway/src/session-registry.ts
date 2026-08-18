export interface NappletSession {
  readonly windowId: string;
  readonly nonce: string;
  readonly dTag: string;
  readonly aggregateHash: string;
  readonly source: Window;
}

export class SessionRegistry {
  readonly #bySource = new Map<Window, NappletSession>();
  readonly #byId = new Map<string, NappletSession>();

  register(session: NappletSession): void {
    if (this.#byId.has(session.windowId) || this.#bySource.has(session.source)) throw new Error("Napplet session already registered");
    this.#byId.set(session.windowId, session); this.#bySource.set(session.source, session);
  }
  authenticate(source: MessageEventSource | null, nonce: string): NappletSession | undefined {
    if (!(source instanceof Window)) return undefined;
    const session = this.#bySource.get(source);
    return session?.nonce === nonce ? session : undefined;
  }
  get(windowId: string): NappletSession | undefined { return this.#byId.get(windowId); }
  remove(windowId: string): void {
    const session = this.#byId.get(windowId);
    if (!session) return;
    this.#byId.delete(windowId); this.#bySource.delete(session.source);
  }
  clear(): void { this.#byId.clear(); this.#bySource.clear(); }
}
