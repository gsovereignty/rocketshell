import type { PlatformDomain } from "@project/platform-nap-contract";

export interface CapabilityInputs {
  readonly wired: readonly PlatformDomain[];
  readonly policy: readonly PlatformDomain[];
  readonly required: readonly PlatformDomain[];
  readonly granted: readonly PlatformDomain[];
  readonly consented: readonly PlatformDomain[];
}

export function resolveCapabilityProfile(input: CapabilityInputs): readonly PlatformDomain[] {
  const sets = [input.policy, input.required, input.granted, input.consented].map((values) => new Set<PlatformDomain>(values));
  return Object.freeze([...new Set(input.wired)].filter((domain) => sets.every((set) => set.has(domain))));
}
