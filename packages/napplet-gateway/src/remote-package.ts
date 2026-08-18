import { PackageInstaller } from "./package-installer.js";
import { sha256 } from "./hashing.js";
import { parseManifest, type EventVerifier } from "./manifest-verifier.js";
import type { ArtifactInput, InstallationRecord, PackageStore, SignedManifest } from "./types.js";

export const MAX_REMOTE_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const MAX_REMOTE_PACKAGE_BYTES = 25 * 1024 * 1024;
const MAX_MANIFEST_SERVERS = 8;
const FETCH_TIMEOUT_MS = 20_000;

export interface RemotePackageOptions {
  readonly fetch?: typeof fetch;
  readonly verifyEvent?: EventVerifier;
  readonly allowHttpLocalhost?: boolean;
}

const isLocalhost = (hostname: string): boolean => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export function manifestServers(event: SignedManifest, allowHttpLocalhost = false): URL[] {
  const values = [...new Set(event.tags.filter((tag) => tag[0] === "server").map((tag) => tag[1]).filter((value): value is string => Boolean(value)))];
  if (values.length === 0) throw new Error("Manifest has no artifact servers");
  if (values.length > MAX_MANIFEST_SERVERS) throw new Error("Manifest has too many artifact servers");
  return values.map((value) => {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && allowHttpLocalhost && isLocalhost(url.hostname);
    if (url.protocol !== "https:" && !localHttp) throw new Error("Artifact server scheme forbidden");
    if (url.username || url.password || url.hash || url.search) throw new Error("Artifact server URL contains forbidden components");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
  });
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_ARTIFACT_BYTES) throw new Error("Artifact exceeds size limit");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REMOTE_ARTIFACT_BYTES) throw new Error("Artifact exceeds size limit");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REMOTE_ARTIFACT_BYTES) {
      await reader.cancel();
      throw new Error("Artifact exceeds size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchArtifact(hash: string, servers: readonly URL[], fetcher: typeof fetch): Promise<Uint8Array> {
  for (const server of servers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetcher(new URL(hash, server), {
        method: "GET", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", signal: controller.signal
      });
      if (!response.ok || response.status >= 300) continue;
      const bytes = await readBounded(response);
      if (await sha256(bytes) !== hash) continue;
      return bytes;
    } catch {
      // Try the next signed server hint. Caller receives one opaque failure.
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Unable to fetch a verified Napplet artifact");
}

export async function installRemotePackage(store: PackageStore, event: SignedManifest, options: RemotePackageOptions = {}): Promise<InstallationRecord> {
  const manifest = parseManifest(event, options.verifyEvent);
  const existing = await store.get(manifest.dTag, manifest.aggregateHash);
  if (existing?.manifestEvent.id === event.id) {
    await store.activate(existing.dTag, existing.aggregateHash);
    return existing;
  }
  const servers = manifestServers(event, options.allowHttpLocalhost);
  const inputs = new Map<string, ArtifactInput>();
  let packageBytes = 0;
  for (const artifact of manifest.artifacts) {
    const bytes = await fetchArtifact(artifact.sha256, servers, options.fetch ?? fetch);
    packageBytes += bytes.byteLength;
    if (packageBytes > MAX_REMOTE_PACKAGE_BYTES) throw new Error("Napplet package exceeds size limit");
    inputs.set(artifact.path, { bytes });
  }
  return new PackageInstaller(store, options.verifyEvent).install(event, inputs);
}
