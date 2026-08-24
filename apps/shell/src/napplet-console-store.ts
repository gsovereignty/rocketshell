export const NAPPLET_CONSOLE_MESSAGE = "__rocketshell.console";
export const NAPPLET_LOG_LIMIT = 500;
const MAX_MESSAGE_ARGS = 41;
const MAX_MESSAGE_ARG_LENGTH = 4_000;
const MAX_MESSAGE_LENGTH = 24_032;

export type NappletLogLevel = "debug" | "log" | "info" | "warn" | "error";
export interface NappletLog {
  readonly id: number;
  readonly windowId: string;
  readonly level: NappletLogLevel;
  readonly timestamp: number;
  readonly args: readonly string[];
}
export interface NappletConsoleMessage {
  readonly type: typeof NAPPLET_CONSOLE_MESSAGE;
  readonly level: NappletLogLevel;
  readonly timestamp: number;
  readonly args: readonly string[];
}

const LEVELS = new Set<NappletLogLevel>(["debug", "log", "info", "warn", "error"]);

export const parseNappletConsoleMessage = (value: unknown): NappletConsoleMessage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== NAPPLET_CONSOLE_MESSAGE || !LEVELS.has(candidate.level as NappletLogLevel)) return undefined;
  if (!Number.isFinite(candidate.timestamp) || !Array.isArray(candidate.args) || candidate.args.length > MAX_MESSAGE_ARGS) return undefined;
  if (!candidate.args.every((item) => typeof item === "string" && item.length <= MAX_MESSAGE_ARG_LENGTH)) return undefined;
  if (candidate.args.reduce((total, item) => total + (item as string).length, 0) > MAX_MESSAGE_LENGTH) return undefined;
  return {
    type: NAPPLET_CONSOLE_MESSAGE,
    level: candidate.level as NappletLogLevel,
    timestamp: candidate.timestamp as number,
    args: Object.freeze([...(candidate.args as string[])])
  };
};

export interface NappletConsoleStore {
  append(windowId: string, message: NappletConsoleMessage): void;
  list(windowId: string): readonly NappletLog[];
  clear(windowId: string): void;
  remove(windowId: string): void;
  subscribe(listener: (windowId: string) => void): () => void;
}

export const createNappletConsoleStore = (limit = NAPPLET_LOG_LIMIT): NappletConsoleStore => {
  const logs = new Map<string, NappletLog[]>();
  const listeners = new Set<(windowId: string) => void>();
  let nextId = 1;
  const notify = (windowId: string): void => { for (const listener of listeners) listener(windowId); };
  return {
    append(windowId, message) {
      const entries = logs.get(windowId) ?? [];
      entries.push({ id: nextId++, windowId, level: message.level, timestamp: message.timestamp, args: message.args });
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      logs.set(windowId, entries);
      notify(windowId);
    },
    list: (windowId) => Object.freeze([...(logs.get(windowId) ?? [])]),
    clear(windowId) { logs.delete(windowId); notify(windowId); },
    remove(windowId) { logs.delete(windowId); notify(windowId); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
};
