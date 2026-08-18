import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { BehaviorSubject, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createRelayAuthenticator, type AccountController } from "../src/index.js";

describe("relay authentication", () => {
  it("uses current account once for each relay challenge and tears down", async () => {
    const challenge$ = new BehaviorSubject<string | null>(null);
    const sign = vi.fn(async (_template: EventTemplate) => ({ id: "signed" }) as NostrEvent);
    const authenticate = vi.fn(async (signer: { signEvent(template: EventTemplate): Promise<NostrEvent> | NostrEvent }) => {
      await signer.signEvent({ kind: 22242, created_at: 1, content: "", tags: [] });
      return { from: "wss://relay.example/", ok: true, message: "authenticated" };
    });
    const relay = { url: "wss://relay.example/", challenge$, get challenge() { return challenge$.value; }, authenticate };
    const additions = new Subject<typeof relay>();
    const pool = { relays: new Map(), add$: additions };
    const accounts = { manager: { active: {}, active$: new BehaviorSubject({}) }, generation: 0, sign } as unknown as AccountController;
    const authenticator = createRelayAuthenticator(pool as never, accounts);
    additions.next(relay);
    challenge$.next("challenge-1"); challenge$.next("challenge-1");
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
    expect(sign).toHaveBeenCalledOnce();
    authenticator.close(); challenge$.next("challenge-2");
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it("waits for an account when a challenge arrives signed out", async () => {
    const challenge$ = new BehaviorSubject<string | null>("challenge");
    const authenticate = vi.fn(async () => ({ from: "wss://relay.example/", ok: true, message: "authenticated" }));
    const relay = { url: "wss://relay.example/", challenge$, get challenge() { return challenge$.value; }, authenticate };
    const pool = { relays: new Map([[relay.url, relay]]), add$: new Subject() };
    const active$ = new BehaviorSubject<unknown>(undefined);
    const manager = { active: undefined as unknown, active$ };
    const accounts = { manager, generation: 0, sign: vi.fn(async () => ({ id: "signed" })) } as unknown as AccountController;
    const authenticator = createRelayAuthenticator(pool as never, accounts);
    expect(authenticate).not.toHaveBeenCalled();
    manager.active = {}; active$.next(manager.active);
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
    authenticator.close();
  });
});
