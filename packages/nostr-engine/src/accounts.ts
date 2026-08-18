import type { AccountManager } from "applesauce-accounts";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { failure } from "@project/platform-nap-contract";
import type { Subscription } from "rxjs";

export interface AccountController {
  readonly manager: AccountManager;
  readonly generation: number;
  readonly publicKey: string;
  sign(template: EventTemplate): Promise<NostrEvent>;
  close(): void;
}

export function createAccountController(manager: AccountManager): AccountController {
  let generation = 0;
  let closed = false;
    let initial = true;
  const subscription: Subscription = manager.active$.subscribe(() => { if (initial) initial = false; else generation += 1; });
  return {
    manager,
    get generation() { return generation; },
    get publicKey() { return manager.active?.pubkey ?? ""; },
    async sign(template) {
      const signingGeneration = generation;
      const account = manager.active;
      if (!account) throw new Error("signed-out");
      const signed = await account.signEvent(template);
      if (signingGeneration !== generation || account !== manager.active) {
        const error = new Error("Active account changed during operation") as Error & { failure: ReturnType<typeof failure> };
        error.failure = failure("signer-unavailable", error.message);
        throw error;
      }
      return signed;
    },
    close() { if (closed) return; closed = true; subscription.unsubscribe(); }
  };
}
