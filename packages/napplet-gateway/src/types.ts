import type { PlatformDomain } from "@project/platform-nap-contract";

export interface ArtifactDeclaration {
  readonly path: string;
  readonly sha256: string;
  readonly mediaType: string;
}

export interface NappletManifest {
  readonly dTag: string;
  readonly title?: string;
  readonly aggregateHash: string;
  readonly entrypoint: string;
  readonly requires: readonly PlatformDomain[];
  readonly artifacts: readonly ArtifactDeclaration[];
  readonly archetypes?: readonly { readonly slug: string; readonly convention: string }[];
}

export interface SignedManifest {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: string[][];
  readonly content: string;
  readonly sig: string;
}

export interface ArtifactInput { readonly bytes: Uint8Array; readonly mediaType?: string }

export interface StoredArtifact extends ArtifactDeclaration { readonly bytes: Uint8Array }

export interface InstallationRecord {
  readonly installationId: string;
  readonly dTag: string;
  readonly aggregateHash: string;
  readonly manifestEvent: SignedManifest;
  readonly manifest: NappletManifest;
  readonly namespacePrelude: string;
  readonly artifacts: readonly StoredArtifact[];
  readonly committedAt: number;
}

export interface ActiveVersion { readonly dTag: string; readonly aggregateHash: string }

export interface PackageStore {
  stage(record: InstallationRecord): Promise<void>;
  commit(installationId: string): Promise<void>;
  activate(dTag: string, aggregateHash: string): Promise<void>;
  get(dTag: string, aggregateHash: string): Promise<InstallationRecord | undefined>;
  getActive(dTag: string): Promise<InstallationRecord | undefined>;
  listActive(): Promise<InstallationRecord[]>;
  getArtifact(dTag: string, aggregateHash: string, path: string): Promise<StoredArtifact | undefined>;
  discard(installationId: string): Promise<void>;
}
