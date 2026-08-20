const OPEN_NAPPLETS_KEY = "shell.open-napplets";

export interface OpenNappletsStore {
  get(): readonly string[];
  add(coordinate: string): void;
  remove(coordinate: string): void;
}

export const createOpenNappletsStore = (storage: Storage): OpenNappletsStore => {
  const get = (): string[] => {
    try {
      const value: unknown = JSON.parse(storage.getItem(OPEN_NAPPLETS_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
    } catch {
      return [];
    }
  };

  const set = (coordinates: readonly string[]): void => {
    try { storage.setItem(OPEN_NAPPLETS_KEY, JSON.stringify(coordinates)); }
    catch { /* Storage failure must not prevent napplets opening or closing. */ }
  };

  return {
    get,
    add(coordinate) { set([...get(), coordinate]); },
    remove(coordinate) {
      const coordinates = get();
      const index = coordinates.indexOf(coordinate);
      if (index < 0) return;
      set(coordinates.filter((_item, itemIndex) => itemIndex !== index));
    }
  };
};
