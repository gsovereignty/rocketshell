import { npubEncode } from "nostr-tools/nip19";

export function pubkeyAvatarHue(pubkey: string) {
  return Array.from(pubkey).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) % 360, 0);
}

export function pubkeyAvatarLabel(pubkey: string) {
  return pubkey.slice(0, 2).toUpperCase().padEnd(2, "?");
}

export function pubkeyDisplay(pubkey: string) {
  const npub = npubEncode(pubkey);
  return `${npub.slice(0, 12)}…${npub.slice(-8)}`;
}
