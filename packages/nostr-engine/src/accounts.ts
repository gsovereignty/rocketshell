import type { AccountManager } from "applesauce-accounts";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { failure } from "@project/platform-nap-contract";
import type { Subscription } from "rxjs";

export class AccountGenerationError extends Error {
  readonly failure = failure("signer-unavailable", "Active account changed during operation");
}

export class AccountController {
  #generation = 0;
  readonly #subscription: Subscription;

  constructor(readonly manager: AccountManager) {
    let initial = true;
    this.#subscription = manager.active$.subscribe(() => { if (initial) initial = false; else this.#generation += 1; });
  }

  get generation(): number { return this.#generation; }
  get publicKey(): string { return this.manager.active?.pubkey ?? ""; }

  async sign(template: EventTemplate): Promise<NostrEvent> {
    const generation = this.#generation;
    const account = this.manager.active;
    if (!account) throw new Error("signed-out");
    const signed = await account.signEvent(template);
    if (generation !== this.#generation || account !== this.manager.active) throw new AccountGenerationError();
    return signed;
  }

  close(): void { this.#subscription.unsubscribe(); }
}
