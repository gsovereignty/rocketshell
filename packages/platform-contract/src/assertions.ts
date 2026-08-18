import { PLATFORM_REQUIRED_DOMAINS, type PlatformDomain } from "./domains.js";

export interface CapabilitySource { supports(domain: string): boolean }

export function assertPlatformProfile(source: CapabilitySource, required: readonly PlatformDomain[] = PLATFORM_REQUIRED_DOMAINS): void {
  const missing = required.filter((domain) => !source.supports(domain));
  if (missing.length) throw new Error(`Missing platform domains: ${missing.join(", ")}`);
}
