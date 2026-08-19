import { nip19 } from "nostr-tools";
import type { SignedManifest } from "@platform/napplet-gateway";

const NAPPLET_KIND = 35129;
const STLSTR_PUBLISHER = "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";
const STLSTR_RELAYS = [
  "wss://relay.ditto.pub",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol"
] as const;

const STLSTR_DOCK_DTAGS = [
  "print-discvr",
  "print-search",
  "user-profile",
  "print-detail",
  "print-create",
  "part-library",
  "part-upload",
  "stl-preview",
  "make-detail"
] as const;

export interface DockLauncherPointer {
  readonly dTag: string;
  readonly coordinate: string;
}

export interface DockLauncher extends DockLauncherPointer {
  readonly title: string;
  readonly iconUrl: string;
}

export const dockLauncherPointers = (): readonly DockLauncherPointer[] => STLSTR_DOCK_DTAGS.map((dTag) => ({
  dTag,
  coordinate: nip19.naddrEncode({
    kind: NAPPLET_KIND,
    pubkey: STLSTR_PUBLISHER,
    identifier: dTag,
    relays: [...STLSTR_RELAYS]
  })
}));

const tagValue = (event: SignedManifest, name: string): string | undefined =>
  event.tags.find((tag) => tag[0] === name && tag[1]?.trim())?.[1]?.trim();

const allowedIconUrl = (value: string, allowLocalPlaintext: boolean): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.href;
    if (allowLocalPlaintext && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.href;
  } catch {
    return undefined;
  }
  return undefined;
};

export const dockLauncherFromManifest = (
  pointer: DockLauncherPointer,
  event: SignedManifest,
  allowLocalPlaintext = false
): DockLauncher | undefined => {
  const icon = tagValue(event, "icon");
  if (!icon) return undefined;
  const iconUrl = allowedIconUrl(icon, allowLocalPlaintext);
  if (!iconUrl) return undefined;
  return {
    ...pointer,
    title: tagValue(event, "title") ?? pointer.dTag,
    iconUrl
  };
};
