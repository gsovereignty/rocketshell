import type { Relay, RelayPool } from "applesauce-relay";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";
import { distinctUntilChanged, filter, Subscription } from "rxjs";
import type { AccountController } from "./accounts.js";

export interface RelayAuthenticator { close(): void }

export function createRelayAuthenticator(
  pool: RelayPool,
  accounts: AccountController,
  onError?: (relay: string, error: unknown) => void,
  telemetry: PlatformTelemetry = NOOP_TELEMETRY
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
      .then((outcome) => telemetry.record("relay.authentication", outcome.ok ? 1 : 0, { relay: relay.url }))
      .catch((error: unknown) => { telemetry.record("relay.authentication", 0, { relay: relay.url }); onError?.(relay.url, error); });
  };
  const watch = (relay: Relay): void => {
    if (closed || watched.has(relay)) return;
    const subscription = new Subscription();
    subscription.add(relay.challenge$.pipe(
      filter((challenge): challenge is string => typeof challenge === "string" && challenge.length > 0),
      distinctUntilChanged()
    ).subscribe(() => authenticate(relay)));
    subscription.add(relay.connected$.pipe(distinctUntilChanged()).subscribe((connected) => {
      telemetry.record("relay.connection", connected ? 1 : 0, { relay: relay.url });
    }));
    subscription.add(relay.attempts$.pipe(distinctUntilChanged(), filter((attempts) => attempts > 0)).subscribe((attempts) => {
      telemetry.record("relay.reconnect", attempts, { relay: relay.url });
    }));
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
