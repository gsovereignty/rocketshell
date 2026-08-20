import { RelayPool, type Relay } from "applesauce-relay";
import { combineLatest, distinctUntilChanged, map, of, switchMap, type Observable } from "rxjs";

type RelayConnection = Pick<Relay, "connected$">;

export const countConnectedRelays = (
  relays$: Observable<ReadonlyMap<string, RelayConnection>>
): Observable<number> => relays$.pipe(
  switchMap((relays) => relays.size === 0
    ? of(0)
    : combineLatest([...relays.values()].map((relay) => relay.connected$)).pipe(
      map((connected) => connected.filter(Boolean).length)
    )),
  distinctUntilChanged()
);

/** The one relay pool. Connections are opened lazily on the first request, so importing is free. */
export const relayPool = new RelayPool();
export const connectedRelayCount$ = countConnectedRelays(relayPool.relays$);
