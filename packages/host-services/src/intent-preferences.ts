export interface IntentPreferenceStore {
  get(account: string, archetype: string): string | undefined;
  set(account: string, archetype: string, dTag: string): void;
  remove(account: string, archetype: string): void;
}

export function createIntentPreferenceStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, prefix = "platform:intent-default:v1:"): IntentPreferenceStore {
  const key = (account: string, archetype: string): string => `${prefix}${encodeURIComponent(account)}:${encodeURIComponent(archetype)}`;
  return {
    get: (account, archetype) => storage.getItem(key(account, archetype)) ?? undefined,
    set: (account, archetype, dTag) => storage.setItem(key(account, archetype), dTag),
    remove: (account, archetype) => storage.removeItem(key(account, archetype))
  };
}
