import type { InstallationRecord, PackageStore, StoredArtifact } from "./types.js";
import { PLATFORM_DATABASE_NAMES } from "@project/platform-nap-contract";

const DATABASE_VERSION = 1;
export const PACKAGE_DATABASE_NAME = PLATFORM_DATABASE_NAMES.packages;
const STAGED = "staged";
const PACKAGES = "packages";
const ACTIVE = "active";
const packageKey = (dTag: string, hash: string): string => `${dTag}\0${hash}`;

interface StoredPackage extends InstallationRecord { readonly packageKey: string }
interface ActiveRecord { readonly dTag: string; readonly aggregateHash: string }

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

export class IndexedDbPackageStore implements PackageStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(name = PACKAGE_DATABASE_NAME): Promise<IndexedDbPackageStore> {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STAGED)) database.createObjectStore(STAGED, { keyPath: "installationId" });
      if (!database.objectStoreNames.contains(PACKAGES)) database.createObjectStore(PACKAGES, { keyPath: "packageKey" });
      if (!database.objectStoreNames.contains(ACTIVE)) database.createObjectStore(ACTIVE, { keyPath: "dTag" });
    };
    return new IndexedDbPackageStore(await requestResult(request));
  }

  close(): void { this.database.close(); }

  async stage(record: InstallationRecord): Promise<void> {
    const transaction = this.database.transaction([STAGED, PACKAGES], "readwrite");
    const existing = await requestResult(transaction.objectStore(PACKAGES).get(packageKey(record.dTag, record.aggregateHash)) as IDBRequest<StoredPackage | undefined>);
    if (existing) { transaction.abort(); throw new Error("Package version already committed"); }
    transaction.objectStore(STAGED).add(structuredClone(record));
    await transactionDone(transaction);
  }

  async commit(installationId: string): Promise<void> {
    const transaction = this.database.transaction([STAGED, PACKAGES], "readwrite");
    const staged = await requestResult(transaction.objectStore(STAGED).get(installationId) as IDBRequest<InstallationRecord | undefined>);
    if (!staged) { transaction.abort(); throw new Error("Unknown staged installation"); }
    const stored: StoredPackage = { ...staged, packageKey: packageKey(staged.dTag, staged.aggregateHash) };
    transaction.objectStore(PACKAGES).add(stored);
    transaction.objectStore(STAGED).delete(installationId);
    await transactionDone(transaction);
  }

  async activate(dTag: string, aggregateHash: string): Promise<void> {
    const transaction = this.database.transaction([PACKAGES, ACTIVE], "readwrite");
    const stored = await requestResult(transaction.objectStore(PACKAGES).get(packageKey(dTag, aggregateHash)) as IDBRequest<StoredPackage | undefined>);
    if (!stored) { transaction.abort(); throw new Error("Cannot activate uncommitted package"); }
    transaction.objectStore(ACTIVE).put({ dTag, aggregateHash } satisfies ActiveRecord);
    await transactionDone(transaction);
  }

  async get(dTag: string, aggregateHash: string): Promise<InstallationRecord | undefined> {
    const transaction = this.database.transaction(PACKAGES, "readonly");
    const stored = await requestResult(transaction.objectStore(PACKAGES).get(packageKey(dTag, aggregateHash)) as IDBRequest<StoredPackage | undefined>);
    await transactionDone(transaction);
    if (!stored) return undefined;
    const { packageKey: _, ...record } = stored;
    return record;
  }

  async getActive(dTag: string): Promise<InstallationRecord | undefined> {
    const transaction = this.database.transaction(ACTIVE, "readonly");
    const active = await requestResult(transaction.objectStore(ACTIVE).get(dTag) as IDBRequest<ActiveRecord | undefined>);
    await transactionDone(transaction);
    return active ? this.get(active.dTag, active.aggregateHash) : undefined;
  }

  async listActive(): Promise<InstallationRecord[]> {
    const transaction = this.database.transaction(ACTIVE, "readonly");
    const active = await requestResult(transaction.objectStore(ACTIVE).getAll() as IDBRequest<ActiveRecord[]>);
    await transactionDone(transaction);
    const records = await Promise.all(active.map((item) => this.get(item.dTag, item.aggregateHash)));
    return records.filter((record): record is InstallationRecord => Boolean(record));
  }

  async getArtifact(dTag: string, aggregateHash: string, path: string): Promise<StoredArtifact | undefined> {
    return (await this.get(dTag, aggregateHash))?.artifacts.find((artifact) => artifact.path === path);
  }

  async discard(installationId: string): Promise<void> {
    const transaction = this.database.transaction(STAGED, "readwrite");
    transaction.objectStore(STAGED).delete(installationId);
    await transactionDone(transaction);
  }
}
