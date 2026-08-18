import type { AccountManager, IAccount } from "applesauce-accounts";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { failure } from "@project/platform-nap-contract";
import type { Subscription } from "rxjs";

export interface AccountController {
  readonly manager: AccountManager;
  readonly generation: number;
  readonly publicKey: string;
  sign(template: EventTemplate): Promise<NostrEvent>;
  nip04Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
  close(): void;
}

export function createAccountController(manager: AccountManager): AccountController {
  let generation = 0;
  let closed = false;
  let initial = true;
  const subscription: Subscription = manager.active$.subscribe(() => { if (initial) initial = false; else generation += 1; });
  const unavailable = (message: string): Error => {
    const error = new Error(message) as Error & { failure: ReturnType<typeof failure> };
    error.failure = failure("signer-unavailable", message);
    return error;
  };
  const withCurrent = async <T>(operation: (account: IAccount) => Promise<T> | T): Promise<T> => {
    const operationGeneration = generation;
    const account = manager.active;
    if (!account) throw unavailable("signed-out");
    const result = await operation(account);
    if (operationGeneration !== generation || account !== manager.active) throw unavailable("Active account changed during operation");
    return result;
  };
  return {
    manager,
    get generation() { return generation; },
    get publicKey() { return manager.active?.pubkey ?? ""; },
    sign: (template) => withCurrent((account) => account.signEvent(template)),
    nip04Encrypt: (pubkey, plaintext) => withCurrent((account) => {
      if (!account.nip04) throw unavailable("NIP-04 unavailable"); return account.nip04.encrypt(pubkey, plaintext);
    }),
    nip04Decrypt: (pubkey, ciphertext) => withCurrent((account) => {
      if (!account.nip04) throw unavailable("NIP-04 unavailable"); return account.nip04.decrypt(pubkey, ciphertext);
    }),
    nip44Encrypt: (pubkey, plaintext) => withCurrent((account) => {
      if (!account.nip44) throw unavailable("NIP-44 unavailable"); return account.nip44.encrypt(pubkey, plaintext);
    }),
    nip44Decrypt: (pubkey, ciphertext) => withCurrent((account) => {
      if (!account.nip44) throw unavailable("NIP-44 unavailable"); return account.nip44.decrypt(pubkey, ciphertext);
    }),
    close() { if (closed) return; closed = true; subscription.unsubscribe(); }
  };
}
