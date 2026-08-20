const OPEN_NAPPLETS_KEY = "shell.open-napplets";

export interface OpenNappletsStore {
  get(): readonly OpenNapplet[];
  add(coordinate: string, dTag: string): void;
  identify(coordinate: string, dTag: string): void;
  remove(coordinate: string): void;
}

export interface OpenNapplet {
  readonly coordinate: string;
  readonly dTag?: string;
}

export const createOpenNappletsStore = (storage: Storage): OpenNappletsStore => {
  const get = (): OpenNapplet[] => {
    try {
      const value: unknown = JSON.parse(storage.getItem(OPEN_NAPPLETS_KEY) ?? "[]");
      if (!Array.isArray(value)) return [];
      return value.flatMap((item): OpenNapplet[] => {
        // Migrate coordinates saved by the first localStorage implementation.
        if (typeof item === "string" && item.length > 0) return [{ coordinate: item }];
        if (!item || typeof item !== "object") return [];
        const { coordinate, dTag } = item as { coordinate?: unknown; dTag?: unknown };
        if (typeof coordinate !== "string" || coordinate.length === 0) return [];
        return [{ coordinate, ...(typeof dTag === "string" && dTag.length > 0 ? { dTag } : {}) }];
      });
    } catch {
      return [];
    }
  };

  const set = (napplets: readonly OpenNapplet[]): void => {
    try { storage.setItem(OPEN_NAPPLETS_KEY, JSON.stringify(napplets)); }
    catch { /* Storage failure must not prevent napplets opening or closing. */ }
  };

  return {
    get,
    add(coordinate, dTag) { set([...get(), { coordinate, dTag }]); },
    identify(coordinate, dTag) {
      const napplets = get();
      const index = napplets.findIndex((napplet) => napplet.coordinate === coordinate && !napplet.dTag);
      if (index < 0) return;
      set(napplets.map((napplet, itemIndex) => itemIndex === index ? { coordinate, dTag } : napplet));
    },
    remove(coordinate) {
      const napplets = get();
      const index = napplets.findIndex((napplet) => napplet.coordinate === coordinate);
      if (index < 0) return;
      set(napplets.filter((_item, itemIndex) => itemIndex !== index));
    }
  };
};
