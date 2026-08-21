/**
 * What the shell's own UI needs from the Nostr layer.
 *
 * The UI reads these directly rather than through {@link BrowserPlatform}: they are already
 * reactive, so routing them through the platform object only added a second name for each one.
 * `BrowserPlatform` keeps the things that genuinely need composing at boot — windows, packages,
 * services and the account list editor.
 */
export {
  activePubkey$, activeProfile$, mailboxes$, ownBlossomServers$, normalizeMediaServer, signedEvents$
} from "@platform/nostr-engine";

import { relayPolicy } from "@platform/nostr-engine";

/** Normalizes a relay URL, throwing a readable message when the platform policy rejects it. */
export const normalizeRelay = (url: string): string => relayPolicy.normalize(url.trim(), "write");

/** How many relays a single tier may hold; the panel checks this before offering to save. */
export const relayLimit = relayPolicy.maximumRelays;
