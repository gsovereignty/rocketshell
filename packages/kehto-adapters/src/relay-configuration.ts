import type { RelayContext, RelayPolicy } from "@platform/nostr-engine";

export type RelayTier = "discovery" | "super" | "outbox";
export interface RelayConfigurationSnapshot { readonly discovery: string[]; readonly super: string[]; readonly outbox: string[] }
export interface PlatformRelayConfiguration {
  add(tier: string, url: string): void;
  remove(tier: string, url: string): void;
  /** Replaces a whole tier in place, keeping the array identity the live consumers hold. */
  replace(tier: RelayTier, urls: readonly string[]): void;
  values(tier: RelayTier): string[];
  snapshot(): RelayConfigurationSnapshot;
}

const contextFor = (tier: RelayTier): RelayContext => tier === "super" ? "read" : tier === "outbox" ? "write" : "discovery";
const requireTier = (tier: string): RelayTier => {
  if (tier === "discovery" || tier === "super" || tier === "outbox") return tier;
  throw new Error(`Unsupported relay tier: ${tier}`);
};

export function createRelayConfiguration(policy: RelayPolicy, initial: RelayConfigurationSnapshot): PlatformRelayConfiguration {
  const tiers: Record<RelayTier, string[]> = {
    discovery: policy.select(initial.discovery, "discovery"),
    super: policy.select(initial.super, "read"),
    outbox: policy.select(initial.outbox, "write")
  };
  return {
    add(tierName, url) {
      const tier = requireTier(tierName); const next = policy.select([...tiers[tier], url], contextFor(tier));
      tiers[tier].splice(0, tiers[tier].length, ...next);
    },
    replace(tier, urls) {
      const next = policy.select([...urls], contextFor(tier));
      tiers[tier].splice(0, tiers[tier].length, ...next);
    },
    remove(tierName, url) {
      const tier = requireTier(tierName); const normalized = policy.normalize(url, contextFor(tier));
      const index = tiers[tier].indexOf(normalized); if (index >= 0) tiers[tier].splice(index, 1);
    },
    values: (tier) => tiers[tier],
    snapshot: () => ({ discovery: [...tiers.discovery], super: [...tiers.super], outbox: [...tiers.outbox] })
  };
}
