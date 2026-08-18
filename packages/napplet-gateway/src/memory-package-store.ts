import type { InstallationRecord, PackageStore, StoredArtifact } from "./types.js";

const key = (dTag: string, hash: string): string => `${dTag}\0${hash}`;

export class MemoryPackageStore implements PackageStore {
  readonly #staged = new Map<string, InstallationRecord>();
  readonly #committed = new Map<string, InstallationRecord>();
  readonly #active = new Map<string, string>();

  async stage(record: InstallationRecord): Promise<void> {
    if (this.#committed.has(key(record.dTag, record.aggregateHash))) throw new Error("Package version already committed");
    this.#staged.set(record.installationId, structuredClone(record));
  }
  async commit(installationId: string): Promise<void> {
    const record = this.#staged.get(installationId);
    if (!record) throw new Error("Unknown staged installation");
    this.#committed.set(key(record.dTag, record.aggregateHash), record);
    this.#staged.delete(installationId);
  }
  async activate(dTag: string, aggregateHash: string): Promise<void> {
    if (!this.#committed.has(key(dTag, aggregateHash))) throw new Error("Cannot activate uncommitted package");
    this.#active.set(dTag, aggregateHash);
  }
  async get(dTag: string, aggregateHash: string): Promise<InstallationRecord | undefined> { return this.#committed.get(key(dTag, aggregateHash)); }
  async getActive(dTag: string): Promise<InstallationRecord | undefined> {
    const hash = this.#active.get(dTag); return hash ? this.get(dTag, hash) : undefined;
  }
  async listActive(): Promise<InstallationRecord[]> {
    return Promise.all([...this.#active].map(([dTag, hash]) => this.get(dTag, hash))).then((records) => records.filter((record): record is InstallationRecord => Boolean(record)));
  }
  async getArtifact(dTag: string, aggregateHash: string, path: string): Promise<StoredArtifact | undefined> {
    return (await this.get(dTag, aggregateHash))?.artifacts.find((artifact) => artifact.path === path);
  }
  async discard(installationId: string): Promise<void> { this.#staged.delete(installationId); }
}
