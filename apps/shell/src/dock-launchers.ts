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

const linkAttribute = (tag: string, name: string): string | undefined => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
};

const documentFavicon = (record: InstallationRecord, applicationBase: string): string | undefined => {
  const entrypoint = record.artifacts.find((artifact) => artifact.path === record.manifest.entrypoint && artifact.mediaType === "text/html");
  if (!entrypoint) return undefined;
  const document = new TextDecoder().decode(entrypoint.bytes);
  for (const match of document.matchAll(/<link\b[^>]*>/gi)) {
    const rel = linkAttribute(match[0], "rel")?.toLowerCase().split(/\s+/);
    const href = linkAttribute(match[0], "href")?.trim();
    if (!rel?.includes("icon") || !href) continue;
    if (/^data:image\//i.test(href)) return href;
    const base = new URL(record.manifest.entrypoint, "https://napplet.invalid/");
    const resolved = new URL(href, base);
    if (resolved.origin !== base.origin) continue;
    const path = decodeURIComponent(resolved.pathname).replace(/^\//, "");
    const artifact = record.artifacts.find((candidate) => candidate.path === path && candidate.mediaType.startsWith("image/"));
    if (artifact) return virtualNappletUrl(applicationBase, record.dTag, record.aggregateHash, artifact.path);
  }
  return undefined;
};

export const dockLauncherFromManifest = (
  record: InstallationRecord,
  relays: readonly string[],
  applicationBase: string
): DockLauncher => {
  const favicon = packagedFavicon(record);
  const iconUrl = favicon
    ? virtualNappletUrl(applicationBase, record.dTag, record.aggregateHash, favicon.path)
    : documentFavicon(record, applicationBase);
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
    ...(iconUrl ? { iconUrl } : {}),
    initial: Array.from(title.trim())[0]?.toLocaleUpperCase() ?? "?"
  };
};
