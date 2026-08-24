import { BehaviorSubject } from "rxjs";
import { describe, expect, it } from "vitest";
import { countConnectedRelays, listConnectedRelays } from "../src/services/relay-pool.js";

describe("connected relays", () => {
  it("tracks, sorts, and removes connected relay URLs", () => {
    const first = { connected$: new BehaviorSubject(false) };
    const second = { connected$: new BehaviorSubject(true) };
    const relays$ = new BehaviorSubject<ReadonlyMap<string, typeof first>>(new Map());
    const connectedRelays$ = listConnectedRelays(relays$);
    const relayLists: (readonly string[])[] = [];
    const counts: number[] = [];
    const listSubscription = connectedRelays$.subscribe((relays) => relayLists.push(relays));
    const countSubscription = countConnectedRelays(connectedRelays$).subscribe((count) => counts.push(count));

    relays$.next(new Map([["wss://z.example/", first], ["wss://a.example/", second]]));
    first.connected$.next(true);
    second.connected$.next(false);
    relays$.next(new Map([["wss://a.example/", second]]));

    expect(relayLists).toEqual([
      [],
      ["wss://a.example/"],
      ["wss://a.example/", "wss://z.example/"],
      ["wss://z.example/"],
      []
    ]);
    expect(counts).toEqual([0, 1, 2, 1, 0]);
    listSubscription.unsubscribe();
    countSubscription.unsubscribe();
  });
});
