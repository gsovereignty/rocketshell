import { PackageInstaller, aggregateHash, sha256, type ArtifactInput, type PackageStore, type SignedManifest } from "@platform/napplet-gateway";
import type { PlatformDomain } from "@project/platform-nap-contract";

interface RegistryArtifact { readonly path: string; readonly sha256: string; readonly mediaType: string }
interface RegistryNapplet {
  readonly name: string;
  readonly dTag: string;
  readonly title?: string;
  readonly url: string;
  readonly requires: readonly PlatformDomain[];
  readonly archetypes?: readonly { readonly slug: string; readonly convention: string }[];
  readonly files: readonly RegistryArtifact[];
}
interface NappletRegistry { readonly version: 1; readonly napplets: readonly RegistryNapplet[] }

const readRegistry = async (base: string): Promise<NappletRegistry> => {
  for (const name of ["napplets.json", "napplets.dev.json"]) {
    try {
      const response = await fetch(`${base}${name}`, { cache: "no-store" });
      if (!response.ok) continue;
      const value = await response.json() as NappletRegistry;
      if (value.version === 1 && Array.isArray(value.napplets)) return value;
    } catch { /* Try next deterministic registry location. */ }
  }
  return { version: 1, napplets: [] };
};

const artifactUrl = (napplet: RegistryNapplet, path: string): string => path === "index.html"
  ? napplet.url
  : `${napplet.url.slice(0, napplet.url.lastIndexOf("/") + 1)}${path.split("/").map(encodeURIComponent).join("/")}`;

export async function installBuiltInNapplets(store: PackageStore, applicationBase: string): Promise<readonly string[]> {
  const registry = await readRegistry(applicationBase);
  const installed: string[] = [];
  for (const napplet of registry.napplets) {
    const aggregate = await aggregateHash(napplet.files);
    const existing = await store.getActive(napplet.dTag);
    if (existing?.aggregateHash === aggregate) { installed.push(napplet.dTag); continue; }
    const inputs = new Map<string, ArtifactInput>();
    for (const declaration of napplet.files) {
      const response = await fetch(artifactUrl(napplet, declaration.path), { cache: "no-store" });
      if (!response.ok) throw new Error(`Built-in Napplet artifact unavailable: ${napplet.dTag}/${declaration.path}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (await sha256(bytes) !== declaration.sha256) throw new Error(`Built-in Napplet artifact changed: ${napplet.dTag}/${declaration.path}`);
      inputs.set(declaration.path, { bytes, mediaType: declaration.mediaType });
    }
    const manifest = {
      dTag: napplet.dTag, title: napplet.title, aggregateHash: aggregate, entrypoint: "index.html",
      requires: napplet.requires, artifacts: napplet.files, archetypes: napplet.archetypes
    };
    const tags = [
      ["d", napplet.dTag], ["x", aggregate, "aggregate"],
      ...napplet.requires.map((domain) => ["requires", domain]),
      ...(napplet.archetypes ?? []).map((item) => ["archetype", item.slug, item.convention]),
      ...napplet.files.map((artifact) => ["path", `/${artifact.path}`, artifact.sha256])
    ];
    const event = { id: "0".repeat(64), pubkey: "0".repeat(64), created_at: 0, kind: 35129, tags, content: JSON.stringify(manifest), sig: "0".repeat(128) } as SignedManifest;
    await new PackageInstaller(store, () => true).install(event, inputs, { randomId: () => `built-in-${napplet.dTag}-${aggregate}` });
    installed.push(napplet.dTag);
  }
  return installed;
}
