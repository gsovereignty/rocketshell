export const REQUIRED_DOMAINS = [
  "shell", "identity", "outbox", "relay", "storage", "resource",
  "config", "theme", "intent", "inc", "link"
] as const;

export type PlatformDomain = (typeof REQUIRED_DOMAINS)[number];

export const OPTIONAL_DOMAINS = new Set<PlatformDomain>([
  "resource", "intent", "inc", "link"
]);
