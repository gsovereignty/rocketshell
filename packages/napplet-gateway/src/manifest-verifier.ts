import { ALL_DOMAINS, failure, type PlatformDomain } from "@project/platform-nap-contract";
import { verifyEvent } from "nostr-tools/pure";
import type { NappletManifest, SignedManifest } from "./types.js";

const allowedDomains = new Set<string>(ALL_DOMAINS);
const hashPattern = /^[a-f0-9]{64}$/;
const safePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

const mediaTypeForPath = (path: string): string => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ({
    html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
    json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", wasm: "application/wasm",
    txt: "text/plain", xml: "application/xml", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm"
  } as Record<string, string>)[extension] ?? "application/octet-stream";
};

export class ManifestVerificationError extends Error {
  readonly failure = failure("invalid-signature", "Napplet manifest verification failed");
}

export type EventVerifier = (event: SignedManifest) => boolean;

export function parseManifest(event: SignedManifest, verifier: EventVerifier = verifyEvent): NappletManifest {
  if (!verifier(event)) throw new ManifestVerificationError();
  if (event.kind !== 35129) throw new TypeError("Manifest must use named NIP-5D kind 35129");
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (!dTag) throw new TypeError("Manifest needs a signed d tag");
  let candidate: Record<string, unknown> | undefined;
  if (event.content.trim()) {
    let value: unknown;
    try { value = JSON.parse(event.content); } catch { throw new TypeError("Manifest content must be valid JSON when present"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Manifest content must be an object");
    candidate = value as Record<string, unknown>;
    if (candidate.dTag !== dTag) throw new TypeError("Manifest dTag must match signed d tag");
  }
  const aggregateHash = candidate?.aggregateHash ?? event.tags.find((tag) => tag[0] === "x" && tag[2] === "aggregate")?.[1];
  if (typeof aggregateHash !== "string" || !hashPattern.test(aggregateHash)) throw new TypeError("Invalid aggregate hash");
  const entrypoint = candidate?.entrypoint ?? "index.html";
  if (typeof entrypoint !== "string" || !safePathPattern.test(entrypoint)) throw new TypeError("Invalid entrypoint");
  const taggedRequires = event.tags.filter((tag) => tag[0] === "requires").map((tag) => tag[1]).filter((value): value is string => typeof value === "string");
  if (taggedRequires.some((domain) => !allowedDomains.has(domain))) throw new TypeError("Invalid required domain");
  const contentRequires = candidate?.requires;
  if (contentRequires !== undefined && !Array.isArray(contentRequires)) throw new TypeError("Invalid required domain");
  const declaredRequires = [...new Set((contentRequires ?? taggedRequires) as unknown[])];
  if (declaredRequires.some((domain) => typeof domain !== "string" || !allowedDomains.has(domain))) throw new TypeError("Invalid required domain");
  const validRequires = declaredRequires as string[];
  if (taggedRequires.length !== validRequires.length || validRequires.some((domain) => !taggedRequires.includes(domain))) throw new TypeError("Manifest requires tags do not match content");
  const contentArtifacts = candidate?.artifacts;
  if (contentArtifacts !== undefined && (!Array.isArray(contentArtifacts) || contentArtifacts.length === 0)) throw new TypeError("Manifest needs artifacts");
  const rawArtifacts: unknown[] = contentArtifacts as unknown[] ?? event.tags
    .filter((tag) => tag[0] === "path")
    .map((tag) => ({ path: tag[1]?.replace(/^\//, ""), sha256: tag[2], mediaType: mediaTypeForPath(tag[1] ?? "") }));
  if (rawArtifacts.length === 0) throw new TypeError("Manifest needs artifacts");
  const paths = new Set<string>();
  const artifacts = rawArtifacts.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid artifact");
    const artifact = raw as Record<string, unknown>;
    if (typeof artifact.path !== "string" || !safePathPattern.test(artifact.path) || paths.has(artifact.path)) throw new TypeError("Invalid or duplicate artifact path");
    if (typeof artifact.sha256 !== "string" || !hashPattern.test(artifact.sha256)) throw new TypeError("Invalid artifact hash");
    if (typeof artifact.mediaType !== "string" || !artifact.mediaType.includes("/")) throw new TypeError("Invalid artifact media type");
    const pathTag = event.tags.find((tag) => tag[0] === "path" && tag[1] === `/${artifact.path}`);
    if (!pathTag || pathTag[2] !== artifact.sha256) throw new TypeError("Manifest path tags do not match artifacts");
    paths.add(artifact.path);
    return { path: artifact.path, sha256: artifact.sha256, mediaType: artifact.mediaType };
  });
  if (!paths.has(entrypoint)) throw new TypeError("Entrypoint is not declared");
  const title = candidate?.title ?? event.tags.find((tag) => tag[0] === "title")?.[1];
  if (title !== undefined && (typeof title !== "string" || title.length > 200)) throw new TypeError("Invalid manifest title");
  const parseArchetypes = (rawArchetypes: unknown): { slug: string; convention: string }[] => {
    if (!Array.isArray(rawArchetypes)) throw new TypeError("Invalid manifest archetypes");
    const seen = new Set<string>();
    return rawArchetypes.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid manifest archetype");
      const item = raw as Record<string, unknown>;
      if (typeof item.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.slug)) throw new TypeError("Invalid archetype slug");
      if (typeof item.convention !== "string" || !/^napplet:[^/?#\s]+\/[^/?#\s]+$/.test(item.convention)) throw new TypeError("Invalid archetype convention");
      const key = `${item.slug}\u0000${item.convention}`;
      if (seen.has(key)) throw new TypeError("Duplicate manifest archetype");
      seen.add(key);
      return { slug: item.slug, convention: item.convention };
    });
  };
  const taggedArchetypeValues = event.tags.filter((tag) => tag[0] === "archetype");
  const taggedArchetypes = taggedArchetypeValues.length === 0 ? undefined : parseArchetypes(taggedArchetypeValues.map((tag) => ({ slug: tag[1], convention: tag[2] })));
  const contentArchetypes = candidate?.archetypes === undefined ? undefined : parseArchetypes(candidate.archetypes);
  if (taggedArchetypes && contentArchetypes) {
    const tagged = new Set(taggedArchetypes.map((item) => `${item.slug}\u0000${item.convention}`));
    if (tagged.size !== contentArchetypes.length || contentArchetypes.some((item) => !tagged.has(`${item.slug}\u0000${item.convention}`))) {
      throw new TypeError("Manifest archetype tags do not match content");
    }
  }
  const archetypes = contentArchetypes ?? taggedArchetypes;
  return {
    dTag, aggregateHash, entrypoint,
    requires: validRequires as PlatformDomain[], artifacts,
    ...(title === undefined ? {} : { title }),
    ...(archetypes === undefined ? {} : { archetypes })
  };
}
