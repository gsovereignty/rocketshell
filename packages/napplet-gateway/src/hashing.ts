const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer)));
}

export function canonicalAggregateInput(artifacts: readonly { path: string; sha256: string }[]): Uint8Array {
  const canonical = [...artifacts]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, sha256: hash }) => `${path}\0${hash}\n`)
    .join("");
  return encoder.encode(canonical);
}

export async function aggregateHash(artifacts: readonly { path: string; sha256: string }[]): Promise<string> {
  return sha256(canonicalAggregateInput(artifacts));
}
