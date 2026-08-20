import { castUser, type User } from "applesauce-common/casts";
import {
  BehaviorSubject, combineLatest, distinctUntilChanged, map, of, shareReplay, startWith, switchMap,
  type Observable
} from "rxjs";
import { accountManager } from "./accounts.js";
import { eventStore } from "./event-store.js";

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** Replay for the lifetime of the process: these feed the loader, which must never lose its value. */
const HOLD = { bufferSize: 1, refCount: false };

/** The signed-in pubkey, or undefined when signed out. */
export const activePubkey$: Observable<string | undefined> = accountManager.active$.pipe(
  map((account) => account?.pubkey),
  distinctUntilChanged(),
  shareReplay(HOLD)
);

const activeUser$: Observable<User | undefined> = activePubkey$.pipe(
  map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)),
  shareReplay(HOLD)
);

/**
 * Reads one list off the active user.
 *
 * The `startWith(undefined)` matters: the cast does not emit until the list resolves, and the
 * combinators below use `combineLatest`, which would stall the loader at boot without a first value.
 */
const own = <T>(select: (user: User) => Observable<T | undefined>): Observable<T | undefined> =>
  activeUser$.pipe(
    switchMap((user) => (user ? select(user).pipe(startWith(undefined)) : of(undefined))),
    // Held so a late subscriber sees the resolved list rather than the seed again.
    shareReplay(HOLD)
  );

/** App-level fallbacks. The shell pushes the settings-panel values in; see `platform.ts`. */
export const fallbackRelays$ = new BehaviorSubject<readonly string[]>([]);
export const fallbackLookupRelays$ = new BehaviorSubject<readonly string[]>([]);
export const fallbackBlossomServers$ = new BehaviorSubject<readonly string[]>([]);

/** What the account publishes wins; the local settings only cover the gap. */
const preferOwn = (
  owned$: Observable<readonly string[] | undefined>,
  fallback$: Observable<readonly string[]>
): Observable<readonly string[]> => combineLatest([owned$, fallback$]).pipe(
  map(([owned, fallback]) => (owned && owned.length > 0 ? owned : fallback)),
  distinctUntilChanged(sameList),
  shareReplay(HOLD)
);

/** The account's own NIP-65 lists, unmixed with any fallback. */
export const outboxes$ = own<string[]>((user) => user.outboxes$);
export const inboxes$ = own<string[]>((user) => user.inboxes$);
export const mailboxes$ = own<{ inboxes: string[]; outboxes: string[] }>((user) => user.mailboxes$);

/** The account's own BUD-03 media servers (kind 10063), as strings. */
export const ownBlossomServers$: Observable<readonly string[] | undefined> =
  own<URL[]>((user) => user.blossomServers$).pipe(map((servers) => servers?.map((server) => server.toString())));

/** The account's own lookup / indexer relays (kind 10086). */
export const ownLookupRelays$: Observable<readonly string[] | undefined> =
  own((user) => user.lookupRelayList$).pipe(map((list) => list?.relays));

export const writeRelays$ = preferOwn(outboxes$, fallbackRelays$);
export const readRelays$ = preferOwn(inboxes$, fallbackRelays$);
export const lookupRelays$ = preferOwn(ownLookupRelays$, fallbackLookupRelays$);
export const blossomServers$ = preferOwn(ownBlossomServers$, fallbackBlossomServers$);
