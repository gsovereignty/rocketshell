import type { NostrEvent } from "applesauce-core/helpers";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { Observable, defaultIfEmpty, firstValueFrom, timeout } from "rxjs";
import type { SignedManifest } from "@platform/napplet-gateway";
import { openRelayStream, type NostrEngine } from "@platform/nostr-engine";

const LOAD_TIMEOUT_MS = 16_000;
const NAMED_NAPPLET_KIND = 35129;
const PUBKEY_PATTERN = /^[a-f0-9]{64}$/;

export interface NappletCoordinate {
  readonly kind: 35129;
  readonly pubkey: string;
  readonly identifier: string;
}

export function parseNappletCoordinate(raw: string): NappletCoordinate {
  const match = /^(\d+):([a-fA-F0-9]{64}):(.+)$/.exec(raw.trim());
  if (!match) throw new Error("Use kind:pubkey:identifier");
  const kind = Number(match[1]);
  const pubkey = match[2]!.toLowerCase();
  const identifier = match[3]!.trim();
  if (kind !== NAMED_NAPPLET_KIND) throw new Error("Only named kind 35129 Napplets are supported");
  if (!PUBKEY_PATTERN.test(pubkey)) throw new Error("Napplet pubkey must be 64 hexadecimal characters");
  if (!identifier || identifier.length > 256) throw new Error("Napplet identifier is invalid");
  return { kind: NAMED_NAPPLET_KIND, pubkey, identifier };
}

export function createManifestResolver(engine: NostrEngine, relayUrls: readonly string[]) {
  const selectedRelays = engine.relayPolicy.select(relayUrls, "discovery");
  const request = (relays: string[], filters: Parameters<typeof openRelayStream>[3]) => new Observable<NostrEvent>((observer) => {
    const selected = engine.relayPolicy.select(relays, "discovery");
    const handle = openRelayStream(engine.relayPool, engine.ingress, selected, filters, {
      event: (event) => observer.next(event), eose: () => observer.complete()
    }, 15_000, engine.telemetry);
    return () => handle.close();
  });
  const loader = createAddressLoader(request, { eventStore: engine.eventStore, bufferTime: 0, extraRelays: selectedRelays });

  return async (rawCoordinate: string): Promise<SignedManifest> => {
    const coordinate = parseNappletCoordinate(rawCoordinate);
    const cached = engine.eventStore.getReplaceable(coordinate.kind, coordinate.pubkey, coordinate.identifier);
    if (selectedRelays.length === 0) throw new Error("No discovery relays configured");
    const event = await firstValueFrom(loader({ ...coordinate, relays: selectedRelays }).pipe(
      timeout({ first: LOAD_TIMEOUT_MS }), defaultIfEmpty(undefined)
    )).catch(() => undefined);
    const resolved = event ?? engine.eventStore.getReplaceable(coordinate.kind, coordinate.pubkey, coordinate.identifier);
    if (!resolved) throw new Error("Napplet manifest not found on discovery relays");
    return resolved as SignedManifest;
  };
}
