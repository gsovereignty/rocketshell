import { decodeAddressPointer } from "applesauce-core/helpers";
import { defaultIfEmpty, firstValueFrom, timeout } from "rxjs";
import type { SignedManifest } from "@platform/napplet-gateway";
import { eventLoader, eventStore, relayPolicy } from "@platform/nostr-engine";

const LOAD_TIMEOUT_MS = 16_000;
const NAMED_NAPPLET_KIND = 35129;
const PUBKEY_PATTERN = /^[a-f0-9]{64}$/;

export interface NappletCoordinate {
  readonly kind: 35129;
  readonly pubkey: string;
  readonly identifier: string;
}

export function parseNappletCoordinate(raw: string): NappletCoordinate {
  const value = raw.trim();
  const pointer = decodeAddressPointer(value.replace(/^nostr:/i, ""));
  const match = /^(\d+):([a-fA-F0-9]{64}):(.+)$/.exec(value);
  if (!pointer && !match) throw new Error("Use naddr or kind:pubkey:identifier");
  const kind = pointer?.kind ?? Number(match![1]);
  const pubkey = (pointer?.pubkey ?? match![2]!).toLowerCase();
  const identifier = (pointer?.identifier ?? match![3]!).trim();
  if (kind !== NAMED_NAPPLET_KIND) throw new Error("Only named kind 35129 Napplets are supported");
  if (!PUBKEY_PATTERN.test(pubkey)) throw new Error("Napplet pubkey must be 64 hexadecimal characters");
  if (!identifier || identifier.length > 256) throw new Error("Napplet identifier is invalid");
  return { kind: NAMED_NAPPLET_KIND, pubkey, identifier };
}

export function createManifestResolver(relayUrls: readonly string[]) {
  // Selected per call rather than once at construction. The previous version snapshotted the
  // relay list here, which was the one path a settings-panel edit never reached.
  const discoveryRelays = (): string[] => relayPolicy.select([...relayUrls], "discovery");

  return async (rawCoordinate: string): Promise<SignedManifest> => {
    const coordinate = parseNappletCoordinate(rawCoordinate);
    const relays = discoveryRelays();
    if (relays.length === 0) throw new Error("No discovery relays configured");
    const event = await firstValueFrom(eventLoader({ ...coordinate, relays }).pipe(
      timeout({ first: LOAD_TIMEOUT_MS }), defaultIfEmpty(undefined)
    )).catch(() => undefined);
    const resolved = event ?? eventStore.getReplaceable(coordinate.kind, coordinate.pubkey, coordinate.identifier);
    if (!resolved) throw new Error("Napplet manifest not found on discovery relays");
    return resolved as SignedManifest;
  };
}
