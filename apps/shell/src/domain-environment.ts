import type { PlatformDomain } from "@project/platform-nap-contract";

export function requireWiredDomains(required: readonly PlatformDomain[], wired: ReadonlySet<string>): readonly PlatformDomain[] {
  const missing = required.filter((domain) => !wired.has(domain));
  if (missing.length) throw new Error(`Missing required Napplet domains: ${missing.join(", ")}`);
  return Object.freeze([...required]);
}
