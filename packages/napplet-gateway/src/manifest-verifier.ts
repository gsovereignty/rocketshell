import { ALL_DOMAINS, failure, type PlatformDomain } from "@project/platform-nap-contract";
import { verifyEvent } from "nostr-tools/pure";
import type { NappletManifest, SignedManifest } from "./types.js";

const allowedDomains = new Set<string>(ALL_DOMAINS);
const hashPattern = /^[a-f0-9]{64}$/;
const safePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

export class ManifestVerificationError extends Error {
  readonly failure = failure("invalid-signature", "Napplet manifest verification failed");
}

export type EventVerifier = (event: SignedManifest) => boolean;

export function parseManifest(event: SignedManifest, verifier: EventVerifier = verifyEvent): NappletManifest {
  if (!verifier(event)) throw new ManifestVerificationError();
  if (event.kind !== 35129) throw new TypeError("Manifest must use named NIP-5D kind 35129");
  let value: unknown;
  try { value = JSON.parse(event.content); } catch { throw new TypeError("Manifest content must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Manifest must be an object");
  const candidate = value as Record<string, unknown>;
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (!dTag || candidate.dTag !== dTag) throw new TypeError("Manifest dTag must match signed d tag");
  if (typeof candidate.aggregateHash !== "string" || !hashPattern.test(candidate.aggregateHash)) throw new TypeError("Invalid aggregate hash");
  if (typeof candidate.entrypoint !== "string" || !safePathPattern.test(candidate.entrypoint)) throw new TypeError("Invalid entrypoint");
  if (!Array.isArray(candidate.requires) || candidate.requires.some((domain) => typeof domain !== "string" || !allowedDomains.has(domain))) throw new TypeError("Invalid required domain");
  const taggedRequires = event.tags.filter((tag) => tag[0] === "requires").map((tag) => tag[1]).filter((value): value is string => typeof value === "string");
  const declaredRequires = [...new Set(candidate.requires as string[])];
  if (taggedRequires.length !== declaredRequires.length || declaredRequires.some((domain) => !taggedRequires.includes(domain))) throw new TypeError("Manifest requires tags do not match content");
  if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) throw new TypeError("Manifest needs artifacts");
  const paths = new Set<string>();
  const artifacts = candidate.artifacts.map((raw) => {
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
  if (!paths.has(candidate.entrypoint)) throw new TypeError("Entrypoint is not declared");
  if (candidate.title !== undefined && (typeof candidate.title !== "string" || candidate.title.length > 200)) throw new TypeError("Invalid manifest title");
  let archetypes: { slug: string; convention: string }[] | undefined;
  if (candidate.archetypes !== undefined) {
    if (!Array.isArray(candidate.archetypes)) throw new TypeError("Invalid manifest archetypes");
    archetypes = candidate.archetypes.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid manifest archetype");
      const item = raw as Record<string, unknown>;
      if (typeof item.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.slug)) throw new TypeError("Invalid archetype slug");
      if (typeof item.convention !== "string" || !/^napplet:[^/?#\s]+\/[^/?#\s]+$/.test(item.convention)) throw new TypeError("Invalid archetype convention");
      return { slug: item.slug, convention: item.convention };
    });
  }
  return {
    dTag, aggregateHash: candidate.aggregateHash, entrypoint: candidate.entrypoint,
    requires: declaredRequires as PlatformDomain[], artifacts,
    ...(candidate.title === undefined ? {} : { title: candidate.title as string }),
    ...(archetypes === undefined ? {} : { archetypes })
  };
}
