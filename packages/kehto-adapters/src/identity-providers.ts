import { getProfileContent, getPublicContacts, type NostrEvent } from "applesauce-core/helpers";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { Observable, defaultIfEmpty, firstValueFrom, timeout } from "rxjs";
import type { NostrEngine } from "@platform/nostr-engine";
import { openRelayStream } from "@platform/nostr-engine";
import type { ProfileData } from "@napplet/nap/identity";

const LOAD_TIMEOUT_MS = 16_000;

export interface IdentityProviders {
  getProfile(pubkey: string): Promise<ProfileData | null>;
  getFollows(pubkey: string): Promise<string[]>;
}

const toProfile = (event: NostrEvent | undefined): ProfileData | null => {
  if (!event) return null;
  const profile = getProfileContent(event);
  if (!profile) return null;
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.display_name || profile.displayName ? { displayName: profile.display_name ?? profile.displayName } : {}),
    ...(profile.about ? { about: profile.about } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    ...(profile.banner ? { banner: profile.banner } : {}),
    ...(profile.nip05 ? { nip05: profile.nip05 } : {}),
    ...(profile.lud16 ? { lud16: profile.lud16 } : {}),
    ...(profile.website ? { website: profile.website } : {})
  };
};

export function createIdentityProviders(engine: NostrEngine, relayUrls: readonly string[]): IdentityProviders {
  const request = (relays: string[], filters: Parameters<typeof openRelayStream>[3]) => new Observable<NostrEvent>((observer) => {
    const selected = engine.relayPolicy.select(relays, "read");
    const handle = openRelayStream(engine.relayPool, engine.ingress, selected, filters, {
      event: (event) => observer.next(event), eose: () => observer.complete()
    }, 15_000, engine.telemetry);
    return () => handle.close();
  });
  const loader = createAddressLoader(request, { eventStore: engine.eventStore, bufferTime: 0, extraRelays: [...relayUrls] });
  const resolve = async (kind: number, pubkey: string): Promise<NostrEvent | undefined> => {
    const cached = engine.eventStore.getReplaceable(kind, pubkey);
    if (cached || !pubkey || relayUrls.length === 0) return cached;
    try {
      const event = await firstValueFrom(loader({ kind, pubkey, relays: [...relayUrls] }).pipe(
        timeout({ first: LOAD_TIMEOUT_MS }), defaultIfEmpty(undefined)
      ));
      return event ?? engine.eventStore.getReplaceable(kind, pubkey);
    } catch {
      return engine.eventStore.getReplaceable(kind, pubkey);
    }
  };
  return {
    getProfile: async (pubkey) => toProfile(await resolve(0, pubkey)),
    getFollows: async (pubkey) => {
      const contacts = await resolve(3, pubkey);
      return contacts ? [...new Set(getPublicContacts(contacts).map((contact) => contact.pubkey))] : [];
    }
  };
}
