export const PROTOCOL_MANDATORY_DOMAINS = ["shell"] as const;

export const PLATFORM_REQUIRED_DOMAINS = [
  "identity", "outbox", "relay", "storage", "resource",
  "config", "theme", "intent", "inc", "link"
] as const;

export const PLATFORM_OPTIONAL_DOMAINS = [
  "notify", "upload", "count", "keys", "media", "common", "lists",
  "dm", "fs", "serial", "ble", "webrtc", "cvm"
] as const;

export const REQUIRED_DOMAINS = [...PROTOCOL_MANDATORY_DOMAINS, ...PLATFORM_REQUIRED_DOMAINS] as const;
export const OPTIONAL_DOMAINS = new Set<string>(PLATFORM_OPTIONAL_DOMAINS);
export const ALL_DOMAINS = [...REQUIRED_DOMAINS, ...PLATFORM_OPTIONAL_DOMAINS] as const;

export type PlatformDomain = (typeof ALL_DOMAINS)[number];
