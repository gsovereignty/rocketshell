import { nip19 } from "nostr-tools";
import type { InstallationRecord } from "@platform/napplet-gateway";

export interface DockLauncher {
  readonly dTag: string;
  readonly coordinate: string;
  readonly title: string;
  readonly iconUrl: string;
}

const tagValue = (record: InstallationRecord, name: string): string | undefined =>
  record.manifestEvent.tags.find((tag) => tag[0] === name && tag[1]?.trim())?.[1]?.trim();

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
  record: InstallationRecord,
  relays: readonly string[],
  allowLocalPlaintext = false
): DockLauncher | undefined => {
  const icon = tagValue(record, "icon");
  if (!icon) return undefined;
  const iconUrl = allowedIconUrl(icon, allowLocalPlaintext);
  if (!iconUrl) return undefined;
  return {
    dTag: record.dTag,
    coordinate: nip19.naddrEncode({
      kind: record.manifestEvent.kind,
      pubkey: record.manifestEvent.pubkey,
      identifier: record.dTag,
      relays: [...relays]
    }),
    title: tagValue(record, "title") ?? record.manifest.title ?? record.dTag,
    iconUrl
  };
};
