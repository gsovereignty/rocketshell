import type { ConfigValues } from "@napplet/nap/config/types";

export interface ConfigValueStore {
  get(scope: string): ConfigValues;
  set(scope: string, values: ConfigValues): void;
}

function cloneValues(values: ConfigValues): ConfigValues {
  return structuredClone(values);
}

export function createMemoryConfigStore(): ConfigValueStore {
  const values = new Map<string, ConfigValues>();
  return {
    get: (scope) => cloneValues(values.get(scope) ?? {}),
    set: (scope, next) => values.set(scope, cloneValues(next))
  };
}

export function createStorageConfigStore(storage: Pick<Storage, "getItem" | "setItem">, prefix = "platform:config:v1:"): ConfigValueStore {
  const key = (scope: string): string => `${prefix}${encodeURIComponent(scope)}`;
  return {
    get(scope) {
      const raw = storage.getItem(key(scope));
      if (raw === null) return {};
      try {
        const parsed: unknown = JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? cloneValues(parsed as ConfigValues) : {};
      } catch {
        return {};
      }
    },
    set: (scope, values) => storage.setItem(key(scope), JSON.stringify(values))
  };
}
