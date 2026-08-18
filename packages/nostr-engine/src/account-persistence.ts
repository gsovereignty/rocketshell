import { AccountManager, type SerializedAccount } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { Subscription } from "rxjs";
import { PLATFORM_DATABASE_NAMES } from "@project/platform-nap-contract";

export interface AccountSnapshot {
  readonly accounts: readonly SerializedAccount[];
  readonly activeAccountId?: string;
}

export interface AccountSnapshotStore {
  load(): Promise<AccountSnapshot | undefined>;
  save(snapshot: AccountSnapshot): Promise<void>;
  close(): void;
}

export const PRIVATE_ACCOUNT_DATABASE_NAME = PLATFORM_DATABASE_NAMES.privateState;
const DATABASE_VERSION = 1;
const SNAPSHOTS = "account-snapshots";
const CURRENT = "current";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

export async function openIndexedDbAccountSnapshotStore(name = PRIVATE_ACCOUNT_DATABASE_NAME): Promise<AccountSnapshotStore> {
  const request = indexedDB.open(name, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(SNAPSHOTS)) request.result.createObjectStore(SNAPSHOTS);
  };
  const database = await requestResult(request);
  return {
    async load(): Promise<AccountSnapshot | undefined> {
      const transaction = database.transaction(SNAPSHOTS, "readonly");
      const snapshot = await requestResult(transaction.objectStore(SNAPSHOTS).get(CURRENT) as IDBRequest<AccountSnapshot | undefined>);
      await transactionDone(transaction);
      if (!snapshot) return undefined;
      if (!Array.isArray(snapshot.accounts) || (snapshot.activeAccountId !== undefined && typeof snapshot.activeAccountId !== "string")) throw new Error("Invalid persisted account snapshot");
      return structuredClone(snapshot);
    },

    async save(snapshot: AccountSnapshot): Promise<void> {
      const transaction = database.transaction(SNAPSHOTS, "readwrite");
      transaction.objectStore(SNAPSHOTS).put(structuredClone(snapshot), CURRENT);
      await transactionDone(transaction);
    },

    close(): void { database.close(); }
  };
}

export interface PersistentAccountManager {
  readonly manager: AccountManager;
  close(): Promise<void>;
}

export async function createPersistentAccountManager(store: AccountSnapshotStore, manager = new AccountManager()): Promise<PersistentAccountManager> {
  registerCommonAccountTypes(manager);
  const restored = await store.load();
  if (restored) {
    manager.fromJSON([...restored.accounts]);
    if (restored.activeAccountId && manager.getAccount(restored.activeAccountId)) manager.setActive(restored.activeAccountId);
  }
  let pending = Promise.resolve(); let persistenceError: unknown; let closed = false;
  const save = (): void => {
    const snapshot: AccountSnapshot = {
      accounts: manager.toJSON(),
      ...(manager.active ? { activeAccountId: manager.active.id } : {})
    };
    pending = pending.then(() => store.save(snapshot)).catch((error: unknown) => { persistenceError = error; });
  };
  const subscriptions = new Subscription();
  subscriptions.add(manager.accounts$.subscribe(save));
  subscriptions.add(manager.active$.subscribe(save));
  return {
    manager,
    async close() {
      if (closed) return;
      closed = true; subscriptions.unsubscribe(); await pending; store.close();
      if (persistenceError) throw persistenceError;
    }
  };
}
