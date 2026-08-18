import { PLATFORM_COMPATIBILITY, PLATFORM_DATABASE_NAMES, type PlatformCompatibility } from "@project/platform-nap-contract";

const DATABASE_VERSION = 1;
const RECORDS = "records";
const COMPATIBILITY = "compatibility";

export interface PlatformMetadataRecord {
  readonly profile: string;
  readonly compatibility: PlatformCompatibility;
  readonly schemaVersions: {
    readonly metadata: 1;
    readonly packages: 1;
    readonly privateAccounts: 1;
  };
}

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

export class PlatformMetadataStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(): Promise<PlatformMetadataStore> {
    const request = indexedDB.open(PLATFORM_DATABASE_NAMES.metadata, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECORDS)) request.result.createObjectStore(RECORDS);
    };
    const store = new PlatformMetadataStore(await requestResult(request));
    await store.writeCompatibility();
    return store;
  }

  private async writeCompatibility(): Promise<void> {
    const record: PlatformMetadataRecord = {
      profile: PLATFORM_COMPATIBILITY.profile,
      compatibility: PLATFORM_COMPATIBILITY,
      schemaVersions: { metadata: 1, packages: 1, privateAccounts: 1 }
    };
    const transaction = this.database.transaction(RECORDS, "readwrite");
    transaction.objectStore(RECORDS).put(record, COMPATIBILITY);
    await transactionDone(transaction);
  }

  close(): void { this.database.close(); }
}
