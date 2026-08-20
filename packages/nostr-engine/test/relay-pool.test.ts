import { BehaviorSubject } from "rxjs";
import { describe, expect, it } from "vitest";
import { countConnectedRelays } from "../src/services/relay-pool.js";

describe("connected relay count", () => {
  it("tracks connection changes and relay additions", () => {
    const first = { connected$: new BehaviorSubject(false) };
    const second = { connected$: new BehaviorSubject(true) };
    const relays$ = new BehaviorSubject<ReadonlyMap<string, typeof first>>(new Map());
    const counts: number[] = [];
    const subscription = countConnectedRelays(relays$).subscribe((count) => counts.push(count));

    relays$.next(new Map([["wss://one", first], ["wss://two", second]]));
    first.connected$.next(true);
    second.connected$.next(false);

    expect(counts).toEqual([0, 1, 2, 1]);
    subscription.unsubscribe();
  });
});
