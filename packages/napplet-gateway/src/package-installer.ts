import { aggregateHash, sha256 } from "./hashing.js";
import { renderNappletNamespacePrelude } from "@kehto/shell";
import { parseManifest, type EventVerifier } from "./manifest-verifier.js";
import type { ArtifactInput, InstallationRecord, PackageStore, SignedManifest, StoredArtifact } from "./types.js";

export interface InstallOptions { readonly activate?: boolean; readonly now?: () => number; readonly randomId?: () => string }

export class PackageInstaller {
  constructor(private readonly store: PackageStore, private readonly verifyEvent?: EventVerifier) {}

  async install(event: SignedManifest, inputs: ReadonlyMap<string, ArtifactInput>, options: InstallOptions = {}): Promise<InstallationRecord> {
    const manifest = parseManifest(event, this.verifyEvent);
    const installationId = options.randomId?.() ?? crypto.randomUUID();
    const artifacts: StoredArtifact[] = [];
    for (const declaration of manifest.artifacts) {
      const input = inputs.get(declaration.path);
      if (!input) throw new Error(`Missing artifact: ${declaration.path}`);
      if (input.mediaType && input.mediaType !== declaration.mediaType) throw new Error(`Media type mismatch: ${declaration.path}`);
      if (await sha256(input.bytes) !== declaration.sha256) throw new Error(`Artifact hash mismatch: ${declaration.path}`);
      artifacts.push({ ...declaration, bytes: input.bytes.slice() });
    }
    if (inputs.size !== artifacts.length) throw new Error("Package contains undeclared artifacts");
    if (await aggregateHash(artifacts) !== manifest.aggregateHash) throw new Error("Aggregate hash mismatch");
    const record: InstallationRecord = { installationId, dTag: manifest.dTag, aggregateHash: manifest.aggregateHash, manifestEvent: event, manifest, namespacePrelude: renderNappletNamespacePrelude({ domains: manifest.requires }), artifacts, committedAt: options.now?.() ?? Date.now() };
    await this.store.stage(record);
    try {
      await this.store.commit(installationId);
      if (options.activate !== false) await this.store.activate(record.dTag, record.aggregateHash);
      return record;
    } catch (error) { await this.store.discard(installationId); throw error; }
  }
}
