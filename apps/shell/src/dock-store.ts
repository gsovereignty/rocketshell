const PINNED_NAPPLETS_KEY = "shell.pinned-napplets";

export interface DockStore {
  get(): readonly string[];
  has(coordinate: string): boolean;
  pin(coordinate: string): void;
  unpin(coordinate: string): void;
}

export const createDockStore = (storage: Storage): DockStore => {
  const get = (): string[] => {
    try {
      const value: unknown = JSON.parse(storage.getItem(PINNED_NAPPLETS_KEY) ?? "[]");
      if (!Array.isArray(value)) return [];
      return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
    } catch {
      return [];
    }
  };

  const set = (coordinates: readonly string[]): void => {
    try { storage.setItem(PINNED_NAPPLETS_KEY, JSON.stringify(coordinates)); }
    catch { /* Pinning failure must not prevent a napplet from running. */ }
  };

  return {
    get,
    has: (coordinate) => get().includes(coordinate),
    pin(coordinate) { if (!get().includes(coordinate)) set([...get(), coordinate]); },
    unpin(coordinate) { set(get().filter((item) => item !== coordinate)); }
  };
};
