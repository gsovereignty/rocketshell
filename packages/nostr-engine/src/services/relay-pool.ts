import { RelayPool, type Relay } from "applesauce-relay";
import { combineLatest, distinctUntilChanged, map, of, switchMap, type Observable } from "rxjs";

type RelayConnection = Pick<Relay, "connected$">;

export const listConnectedRelays = (
  relays$: Observable<ReadonlyMap<string, RelayConnection>>
): Observable<readonly string[]> => relays$.pipe(
  switchMap((relays) => relays.size === 0
    ? of([] as readonly string[])
    : combineLatest([...relays.entries()].map(([url, relay]) => relay.connected$.pipe(
      map((connected) => ({ connected, url }))
    ))).pipe(
      map((states) => states
        .filter(({ connected }) => connected)
        .map(({ url }) => url)
        .sort((left, right) => left.localeCompare(right)))
    )),
  distinctUntilChanged((previous, current) => previous.length === current.length
    && previous.every((url, index) => url === current[index]))
);

export const countConnectedRelays = (
  connectedRelays$: Observable<readonly string[]>
): Observable<number> => connectedRelays$.pipe(
  map((relays) => relays.length),
  distinctUntilChanged()
);

/** The one relay pool. Connections are opened lazily on the first request, so importing is free. */
export const relayPool = new RelayPool();
export const connectedRelays$ = listConnectedRelays(relayPool.relays$);
export const connectedRelayCount$ = countConnectedRelays(connectedRelays$);
