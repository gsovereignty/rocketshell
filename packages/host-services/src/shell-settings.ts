export type ThemePreference = "system" | "light" | "dark";

/** Shell-owned preferences persisted locally, separate from the account's published nostr lists. */
export interface ShellSettings {
  readonly theme: ThemePreference;
  /** Read/write relays used when the account has not published a NIP-65 list. */
  readonly backupRelays: readonly string[];
  /** Discovery relays handed to the applesauce address loader as lookup relays. */
  readonly lookupRelays: readonly string[];
  /** Blossom servers used when the account has not published a BUD-03 list. */
  readonly backupBlossomServers: readonly string[];
}

export interface ShellSettingsStore {
  get(): ShellSettings;
  update(patch: Partial<ShellSettings>): ShellSettings;
  reset(): ShellSettings;
  subscribe(listener: (settings: ShellSettings) => void): () => void;
}

export const SHELL_SETTINGS_KEY = "platform:settings:v1";
const THEME_PREFERENCES: readonly string[] = ["system", "light", "dark"];

const isThemePreference = (value: unknown): value is ThemePreference => typeof value === "string" && THEME_PREFERENCES.includes(value);

/**
 * A missing key falls back to the shipped default, but a stored empty array is respected so that
 * clearing a list in the settings panel is not silently undone on the next reload.
 */
const readList = (value: unknown, fallback: readonly string[]): readonly string[] => {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
};

export function createShellSettingsStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  defaults: ShellSettings,
  key = SHELL_SETTINGS_KEY
): ShellSettingsStore {
  const parse = (raw: string | null): ShellSettings => {
    if (raw === null) return defaults;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return defaults; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    const record = parsed as Record<string, unknown>;
    return {
      theme: isThemePreference(record.theme) ? record.theme : defaults.theme,
      backupRelays: readList(record.backupRelays, defaults.backupRelays),
      lookupRelays: readList(record.lookupRelays, defaults.lookupRelays),
      backupBlossomServers: readList(record.backupBlossomServers, defaults.backupBlossomServers)
    };
  };

  let settings = parse(storage.getItem(key));
  const listeners = new Set<(settings: ShellSettings) => void>();

  const persist = (next: ShellSettings): ShellSettings => {
    settings = next;
    try { storage.setItem(key, JSON.stringify(next)); }
    catch { /* quota or private-mode failures must not break the panel */ }
    for (const listener of [...listeners]) listener(next);
    return next;
  };

  const subscribe = (listener: (settings: ShellSettings) => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  return {
    get: () => settings,
    update(patch) {
      return persist({
        theme: patch.theme !== undefined && isThemePreference(patch.theme) ? patch.theme : settings.theme,
        backupRelays: patch.backupRelays !== undefined ? readList(patch.backupRelays, settings.backupRelays) : settings.backupRelays,
        lookupRelays: patch.lookupRelays !== undefined ? readList(patch.lookupRelays, settings.lookupRelays) : settings.lookupRelays,
        backupBlossomServers: patch.backupBlossomServers !== undefined ? readList(patch.backupBlossomServers, settings.backupBlossomServers) : settings.backupBlossomServers
      });
    },
    reset() {
      try { storage.removeItem(key); } catch { /* ignore */ }
      settings = defaults;
      for (const listener of [...listeners]) listener(defaults);
      return defaults;
    },
    subscribe
  };
}
