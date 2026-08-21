import type { WindowLaunchDescriptor } from "@platform/napplet-gateway";

const WINDOW_SESSION_KEY = "shell.window-session.v2";
const LEGACY_OPEN_NAPPLETS_KEY = "shell.open-napplets";

export interface PersistedWindow {
  readonly windowId: string;
  readonly dTag?: string;
  readonly launch: WindowLaunchDescriptor;
  readonly hidden: boolean;
  readonly replacesWindowId?: string;
}

export interface WindowSession {
  readonly version: 2;
  readonly windows: readonly PersistedWindow[];
  readonly focusedWindowId?: string;
}

export interface WindowSessionStore {
  get(): WindowSession;
  set(session: WindowSession): void;
}

const emptySession = (): WindowSession => ({ version: 2, windows: [] });

const validLaunch = (value: unknown): value is WindowLaunchDescriptor => {
  if (!value || typeof value !== "object") return false;
  const launch = value as Record<string, unknown>;
  return launch.type === "direct" && typeof launch.coordinate === "string" && launch.coordinate.length > 0 ||
    launch.type === "intent" && typeof launch.sender === "string" && launch.sender.length > 0 &&
      typeof launch.convention === "string" && launch.convention.length > 0;
};

const parseSession = (value: unknown): WindowSession | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const session = value as Record<string, unknown>;
  if (session.version !== 2 || !Array.isArray(session.windows)) return undefined;
  const windows = session.windows.flatMap((value): PersistedWindow[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.windowId !== "string" || !item.windowId || typeof item.dTag !== "string" || !item.dTag || !validLaunch(item.launch)) return [];
    return [{
      windowId: item.windowId, dTag: item.dTag, launch: item.launch,
      hidden: item.hidden === true,
      ...(typeof item.replacesWindowId === "string" && item.replacesWindowId ? { replacesWindowId: item.replacesWindowId } : {})
    }];
  });
  return {
    version: 2, windows,
    ...(typeof session.focusedWindowId === "string" && session.focusedWindowId ? { focusedWindowId: session.focusedWindowId } : {})
  };
};

const migrateLegacy = (storage: Storage): WindowSession => {
  try {
    const value: unknown = JSON.parse(storage.getItem(LEGACY_OPEN_NAPPLETS_KEY) ?? "[]");
    if (!Array.isArray(value)) return emptySession();
    const windows = value.flatMap((entry, index): PersistedWindow[] => {
      const coordinate = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as Record<string, unknown>).coordinate : undefined;
      const dTag = entry && typeof entry === "object" ? (entry as Record<string, unknown>).dTag : undefined;
      if (typeof coordinate !== "string" || !coordinate) return [];
      return [{
        windowId: `legacy-${index}`,
        ...(typeof dTag === "string" && dTag ? { dTag } : {}),
        launch: { type: "direct", coordinate }, hidden: false
      }];
    });
    return { version: 2, windows };
  } catch (error) {
    console.warn("Unable to migrate saved Napplet windows", error);
    return emptySession();
  }
};

export const createWindowSessionStore = (storage: Storage): WindowSessionStore => ({
  get() {
    try {
      const stored = storage.getItem(WINDOW_SESSION_KEY);
      if (stored !== null) return parseSession(JSON.parse(stored)) ?? emptySession();
      return migrateLegacy(storage);
    } catch (error) {
      console.warn("Unable to read saved Napplet window session", error);
      return emptySession();
    }
  },
  set(session) {
    try {
      storage.setItem(WINDOW_SESSION_KEY, JSON.stringify(session));
      storage.removeItem(LEGACY_OPEN_NAPPLETS_KEY);
    } catch (error) {
      console.warn("Unable to save Napplet window session", error);
    }
  }
});
