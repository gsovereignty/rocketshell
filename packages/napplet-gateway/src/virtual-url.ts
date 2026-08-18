export const NAPPLET_ROUTE_SEGMENT = "__napplet__";

export interface VirtualNappletLocation { readonly dTag: string; readonly aggregateHash: string; readonly path: string }

export function virtualNappletUrl(base: string, dTag: string, aggregateHash: string, path: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${NAPPLET_ROUTE_SEGMENT}/${encodeURIComponent(dTag)}/${aggregateHash}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function parseVirtualNappletUrl(url: URL, scopePath: string): VirtualNappletLocation | undefined {
  const base = scopePath.endsWith("/") ? scopePath : `${scopePath}/`;
  if (!url.pathname.startsWith(base)) return undefined;
  const parts = url.pathname.slice(base.length).split("/");
  if (parts.shift() !== NAPPLET_ROUTE_SEGMENT || parts.length < 3) return undefined;
  const [encodedTag, aggregateHash, ...encodedPath] = parts;
  if (!encodedTag || !aggregateHash || !/^[a-f0-9]{64}$/.test(aggregateHash)) return undefined;
  try {
    const path = encodedPath.map(decodeURIComponent).join("/");
    if (!path || path.split("/").includes("..")) return undefined;
    return { dTag: decodeURIComponent(encodedTag), aggregateHash, path };
  } catch { return undefined; }
}
