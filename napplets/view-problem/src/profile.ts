import type { CommonProfileData } from "@napplet/sdk";
import { shortKey } from "./problem";

export function profileDisplayName(profile: CommonProfileData | null | undefined, pubkey: string) {
  return profile?.displayName?.trim() || profile?.name?.trim() || shortKey(pubkey);
}

export function profileInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0]?.slice(0, 2) ?? "??").toUpperCase();
}
