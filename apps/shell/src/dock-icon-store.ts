const DATABASE_NAME = "rocketshell-dock-icons";
const DATABASE_VERSION = 1;
const OVERRIDES = "overrides";

export type DockIconOverride =
  | { readonly type: "letter"; readonly value: string }
  | { readonly type: "image"; readonly dataUrl: string };

export interface DockIconStore {
  get(coordinate: string): Promise<DockIconOverride | undefined>;
  set(coordinate: string, override: DockIconOverride): Promise<void>;
  delete(coordinate: string): Promise<void>;
  close(): void;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Dock icon storage failed"));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error("Dock icon storage aborted"));
  transaction.onerror = () => reject(transaction.error ?? new Error("Dock icon storage failed"));
});

const validOverride = (value: unknown): value is DockIconOverride => {
  if (!value || typeof value !== "object") return false;
  const override = value as { type?: unknown; value?: unknown; dataUrl?: unknown };
  return (override.type === "letter" && typeof override.value === "string" && override.value.length > 0)
    || (override.type === "image" && typeof override.dataUrl === "string" && override.dataUrl.startsWith("data:image/"));
};

export const openDockIconStore = async (): Promise<DockIconStore> => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(OVERRIDES)) request.result.createObjectStore(OVERRIDES);
  };
  const database = await requestResult(request);
  return {
    async get(coordinate) {
      const transaction = database.transaction(OVERRIDES, "readonly");
      const value: unknown = await requestResult(transaction.objectStore(OVERRIDES).get(coordinate));
      return validOverride(value) ? value : undefined;
    },
    async set(coordinate, override) {
      const transaction = database.transaction(OVERRIDES, "readwrite");
      transaction.objectStore(OVERRIDES).put(override, coordinate);
      await transactionDone(transaction);
    },
    async delete(coordinate) {
      const transaction = database.transaction(OVERRIDES, "readwrite");
      transaction.objectStore(OVERRIDES).delete(coordinate);
      await transactionDone(transaction);
    },
    close: () => database.close()
  };
};
