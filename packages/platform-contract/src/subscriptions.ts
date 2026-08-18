export interface Closable { close(): void }

export class SubscriptionRegistry implements Closable {
  #closed = false;
  readonly #subscriptions = new Set<Closable>();

  get closed(): boolean { return this.#closed; }

  add<T extends Closable>(subscription: T): T {
    if (this.#closed) { subscription.close(); return subscription; }
    this.#subscriptions.add(subscription);
    return subscription;
  }

  remove(subscription: Closable): void { this.#subscriptions.delete(subscription); }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const subscription of this.#subscriptions) subscription.close();
    this.#subscriptions.clear();
  }
}
