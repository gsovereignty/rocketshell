import { createEventLoaderForStore, type UnifiedEventLoader } from "applesauce-loaders/loaders";
import { map, type Observable } from "rxjs";
import { eventStore } from "./event-store.js";
import { lookupRelays$, readRelays$ } from "./relay-sources.js";
import { relayPool } from "./relay-pool.js";

/** The loader options want a mutable array; copy so a consumer cannot reach back into the source. */
const mutable = (source: Observable<readonly string[]>): Observable<string[]> =>
  source.pipe(map((relays) => [...relays]));

/**
 * Wires the store's fallback loader, which is what lets casts resolve events the store has not
 * seen yet. Relays are passed as observables rather than arrays, so a settings edit or a change of
 * account reaches the loader without rebuilding it.
 *
 * Must be set up before anything subscribes to a cast; `services/index.ts` imports it early.
 */
export const eventLoader: UnifiedEventLoader = createEventLoaderForStore(eventStore, relayPool, {
  lookupRelays: mutable(lookupRelays$),
  extraRelays: mutable(readRelays$),
  bufferTime: 0
});
