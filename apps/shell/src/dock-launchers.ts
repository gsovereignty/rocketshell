import { nip19 } from "nostr-tools";
import { virtualNappletUrl, type InstallationRecord, type StoredArtifact } from "@platform/napplet-gateway";

export interface DockLauncher {
  readonly dTag: string;
  readonly coordinate: string;
  readonly title: string;
  readonly iconUrl?: string;
  readonly initial: string;
  readonly builtIn?: boolean;
}

const tagValue = (record: InstallationRecord, name: string): string | undefined =>
  record.manifestEvent.tags.find((tag) => tag[0] === name && tag[1]?.trim())?.[1]?.trim();

const faviconNames = ["favicon.svg", "favicon.png", "favicon.webp", "favicon.avif", "favicon.ico"] as const;

const packagedFavicon = (record: InstallationRecord): StoredArtifact | undefined =>
  faviconNames
    .map((path) => record.artifacts.find((artifact) => artifact.path === path && artifact.mediaType.startsWith("image/")))
    .find((artifact) => artifact !== undefined);

export const dockLauncherFromManifest = (
  record: InstallationRecord,
  relays: readonly string[],
  applicationBase: string
): DockLauncher => {
  const favicon = packagedFavicon(record);
  const title = tagValue(record, "title") ?? record.manifest.title ?? record.dTag;
  return {
    dTag: record.dTag,
    coordinate: nip19.naddrEncode({
      kind: record.manifestEvent.kind,
      pubkey: record.manifestEvent.pubkey,
      identifier: record.dTag,
      relays: [...relays]
    }),
    title,
    ...(favicon ? { iconUrl: virtualNappletUrl(applicationBase, record.dTag, record.aggregateHash, favicon.path) } : {}),
    initial: Array.from(title.trim())[0]?.toLocaleUpperCase() ?? "?"
  };
};
