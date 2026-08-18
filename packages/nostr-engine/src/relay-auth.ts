import type { Relay, RelayPool } from "applesauce-relay";
import { distinctUntilChanged, filter, type Subscription } from "rxjs";
import type { AccountController } from "./accounts.js";

export interface RelayAuthenticator { close(): void }

export function createRelayAuthenticator(
  pool: RelayPool,
  accounts: AccountController,
  onError?: (relay: string, error: unknown) => void
): RelayAuthenticator {
  const watched = new Map<Relay, Subscription>();
  const attempted = new Map<Relay, string>();
  let closed = false;
  const authenticate = (relay: Relay): void => {
    const challenge = relay.challenge;
    if (!challenge || !accounts.manager.active) return;
    const attempt = `${accounts.generation}:${challenge}`;
    if (attempted.get(relay) === attempt) return;
    attempted.set(relay, attempt);
    void relay.authenticate({ signEvent: (template) => accounts.sign(template) })
      .catch((error: unknown) => onError?.(relay.url, error));
  };
  const watch = (relay: Relay): void => {
    if (closed || watched.has(relay)) return;
    const subscription = relay.challenge$.pipe(
      filter((challenge): challenge is string => typeof challenge === "string" && challenge.length > 0),
      distinctUntilChanged()
    ).subscribe(() => authenticate(relay));
    watched.set(relay, subscription);
  };
  for (const relay of pool.relays.values()) watch(relay);
  const additions = pool.add$.subscribe(watch);
  const accountChanges = accounts.manager.active$.subscribe(() => {
    for (const relay of watched.keys()) authenticate(relay);
  });
  return { close() {
    if (closed) return;
    closed = true; additions.unsubscribe(); accountChanges.unsubscribe();
    for (const subscription of watched.values()) subscription.unsubscribe();
    watched.clear(); attempted.clear();
  } };
}
