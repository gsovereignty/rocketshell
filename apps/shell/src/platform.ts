import { createShellBridge, originRegistry, type ShellBridge } from "@kehto/shell";
import { createHostAuditTrail, createIntentPreferenceStore, createShellSettingsStore, createStorageConfigStore, registerCoreHostServices, registerIntentService, registerLinkService, registerResourceService, registerUploadService, resourceGrantKey, type ShellSettings, type ShellSettingsStore } from "@platform/host-services";
import { createManifestResolver, createPlatformShellAdapter, createRelayConfiguration, registerCoreServices, type PlatformRelayConfiguration } from "@platform/kehto-adapters";
import { IndexedDbPackageStore, NappletWindowManager, installRemotePackage, type WindowBridge, type WindowIdentity } from "@platform/napplet-gateway";
import {
  MAILBOX_LIST_KIND, accounts, blossomServers$, createAccountListEditor, fallbackBlossomServers$,
  fallbackLookupRelays$, fallbackRelays$, publisher, relayListPublishTargets, relayPolicy,
  shutdownNostrServices, startNostrPersistence, telemetry, type AccountListEditor
} from "@platform/nostr-engine";
import type { Subscription } from "rxjs";
import { PLATFORM_REQUIRED_DOMAINS, type PlatformMetricRecord } from "@project/platform-nap-contract";
import { installFixture } from "./fixture.js";
import { createReadyRegistry } from "./ready-registry.js";
import { coordinateServiceWorkerUpdates, recordWorkerProtocolFailure } from "./service-worker-update.js";
import { PlatformMetadataStore } from "./platform-metadata.js";
import { requireWiredDomains } from "./domain-environment.js";
import { dockLauncherFromManifest, type DockLauncher } from "./dock-launchers.js";
import { installBuiltInNapplets } from "./built-in-napplets.js";

const DEFAULT_DISCOVERY_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"] as const;
const DEFAULT_NETWORK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://bucket.coracle.social"] as const;
const DEFAULT_BLOSSOM_SERVERS = ["https://blossom.primal.net"] as const;

/** Seed values for a first run; from then on the settings panel owns these lists. */
export const DEFAULT_SHELL_SETTINGS: ShellSettings = {
  theme: "system",
  backupRelays: [...DEFAULT_NETWORK_RELAYS],
  lookupRelays: [...DEFAULT_DISCOVERY_RELAYS],
  backupBlossomServers: [...DEFAULT_BLOSSOM_SERVERS]
};

class BrowserWindowBridge implements WindowBridge {
  readonly #ready = createReadyRegistry();
  constructor(private readonly shell: ShellBridge, private readonly wiredDomains: ReadonlySet<string>, private readonly wiredServices: ReadonlySet<string>) {}
  register(identity: WindowIdentity): void {
    originRegistry.register(identity.source, identity.windowId, { dTag: identity.dTag, aggregateHash: identity.aggregateHash });
    const domains = requireWiredDomains(identity.requiredDomains, this.wiredDomains);
    originRegistry.setEnvironment(identity.source, {
      capabilities: { domains },
      services: domains.filter((domain) => this.wiredServices.has(domain))
    });
    this.#ready.register(identity.windowId);
  }
  waitUntilReady(identity: WindowIdentity): Promise<void> {
    return this.#ready.wait(identity.windowId);
  }
  accept(event: MessageEvent): void {
    if (!event.data || typeof event.data !== "object" || event.data.type !== "shell.ready") return;
    const windowId = event.source ? originRegistry.getWindowId(event.source as Window) : undefined;
    if (!windowId) return;
    this.#ready.resolve(windowId);
  }
  unregister(windowId: string): void {
    this.#ready.remove(windowId);
    this.shell.runtime.destroyWindow(windowId);
    this.shell.runtime.sessionRegistry.unregister(windowId);
    originRegistry.unregister(windowId);
  }
}

export interface BrowserPlatform {
  readonly windows: NappletWindowManager;
  connectExtension(): Promise<string>;
  signOut(): void;
  dockLaunchers(): Promise<readonly DockLauncher[]>;
  installAndOpen(coordinate: string): Promise<{ readonly dTag: string; readonly title: string; readonly windowId: string }>;
  openInstalled(dTag: string): Promise<{ readonly dTag: string; readonly title: string; readonly windowId: string }>;
  destroyWindow(windowId: string): void;
  authenticatedWindowIds(): readonly string[];
  telemetrySnapshot(): readonly PlatformMetricRecord[];
  /** Locally persisted shell preferences: theme plus the backup relay and media-server lists. */
  readonly settings: ShellSettingsStore;
  /** Live relay tiers the platform reads, writes and discovers through. */
  readonly relays: PlatformRelayConfiguration;
  /** Reads and publishes the account's own NIP-65 and BUD-03 lists. */
  readonly accountLists: AccountListEditor;
  /** Broadcasts the resolved theme to open napplets over the NAP bridge. */
  publishTheme(theme: { readonly background: string; readonly text: string; readonly primary: string }): void;
  close(): Promise<void>;
}

export async function createBrowserPlatform(container: HTMLElement): Promise<BrowserPlatform> {
  const controlledAtStartup = navigator.serviceWorker.controller !== null;
  const allowLocalPlaintext = import.meta.env.DEV || location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]";
  const settings = createShellSettingsStore(localStorage, DEFAULT_SHELL_SETTINGS);
  const metadataStore = await PlatformMetadataStore.open();
  const packageStore = await IndexedDbPackageStore.open();
  const persistence = await startNostrPersistence();
  const initial = settings.get();
  const relayConfiguration = createRelayConfiguration(relayPolicy, {
    discovery: [...initial.lookupRelays], super: [...initial.backupRelays], outbox: [...initial.backupRelays]
  });
  // Live references into the configuration: consumers below re-read them as the settings panel edits.
  const discoveryRelays = relayConfiguration.values("discovery");
  const readRelays = relayConfiguration.values("super");
  const writeRelays = relayConfiguration.values("outbox");
  let windows: NappletWindowManager | undefined;
  const audit = createHostAuditTrail({ telemetry: telemetry });
  const adapter = createPlatformShellAdapter({
    discoveryRelays, readRelays, writeRelays, relayConfiguration,
    createWindow: () => null,
    intentAvailable: () => windows !== undefined,
    linkAvailable: () => true,
    advertisedServices: ["outbox", "config", "resource", "intent", "link"],
    onAclCheck: (event) => audit.recordAcl(event),
    onUnroutedMessage: (info) => audit.recordUnrouted(info)
  });
  const shell = createShellBridge(adapter);
  const coreServices = registerCoreServices(shell, {
    discoveryRelays, directReadRelays: readRelays, directWriteRelays: writeRelays, relayConfiguration
  });
  const hostServices = registerCoreHostServices(shell.runtime, {
    openSettings: (_windowId, section, context) => {
      const input = window.prompt(`Edit Napplet settings${section ? ` (${section})` : ""} as JSON`, JSON.stringify(context.values, null, 2));
      if (input === null) return;
      try {
        const parsed: unknown = JSON.parse(input);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Settings must be a JSON object");
        context.commit(parsed as Parameters<typeof context.commit>[0]);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Invalid settings");
      }
    },
    publishTheme: (theme) => shell.publishTheme(theme),
    configStore: createStorageConfigStore(localStorage),
    resolveConfigScope: (windowId) => {
      const identity = windows?.findByWindowId(windowId)?.identity;
      if (!identity) return undefined;
      return `${accounts.publicKey || "signed-out"}:${identity.dTag}:${identity.aggregateHash}`;
    }
  });
  const resourceGrants = new Map<string, readonly string[]>();
  const resourcePublishers = new Map<string, string>();
  const resourceIdentityKey = (dTag: string, hash: string): string => `${dTag}\0${hash}`;
  registerResourceService(shell.runtime, {
    grants: resourceGrants,
    resolvePublisher: (dTag, hash) => resourcePublishers.get(resourceIdentityKey(dTag, hash)),
    allowHttpLocalhost: allowLocalPlaintext,
    telemetry: telemetry
  });
  registerLinkService(shell.runtime, {
    allowHttpLocalhost: allowLocalPlaintext,
    confirm: (_windowId, url) => window.confirm(`Open ${url.href} in a new tab?`),
    openExternal: (url) => window.open(url.href, "_blank", "noopener,noreferrer") !== null
  });
  const wiredDomains = new Set<string>(PLATFORM_REQUIRED_DOMAINS);
  const wiredServices = new Set(["outbox", "config", "resource", "intent", "link"]);
  // Always wired: the server list is now editable, so gating the domain on startup state would leave
  // napplets opened before the first edit permanently without upload access.
  const uploads = registerUploadService(shell.runtime, {
    blossomServers: [...initial.backupBlossomServers],
    signEvent: (template) => accounts.sign(template)
  });
  wiredDomains.add("upload"); wiredServices.add("upload");
  const windowBridge = new BrowserWindowBridge(shell, wiredDomains, wiredServices);
  windows = new NappletWindowManager(packageStore, windowBridge, container, import.meta.env.BASE_URL, telemetry);
  shell.registerConsentHandler((request) => {
    const identity = windows?.findByWindowId(request.windowId)?.identity;
    const operation = request.type === "undeclared-service"
      ? `undeclared-service:${request.serviceName ?? "unknown"}`
      : request.type === "firewall-policy"
        ? "firewall-policy"
        : `sign-kind:${request.event?.kind ?? "unknown"}`;
    const allowed = window.confirm(`Allow ${identity?.dTag ?? "Napplet"} to perform ${operation}?`);
    audit.recordConsent({
      ...(identity ? { dTag: identity.dTag, aggregateHash: identity.aggregateHash } : {}), operation, allowed
    });
    request.resolve(allowed);
  });
  const applySettings = (next: ShellSettings): void => {
    // These are only the fallbacks. What the account itself publishes wins; see `relay-sources`.
    fallbackRelays$.next([...next.backupRelays]);
    fallbackLookupRelays$.next([...next.lookupRelays]);
    fallbackBlossomServers$.next([...next.backupBlossomServers]);
    // The napplet-facing `relayConfig` domain still reads these tiers. A list the policy rejects
    // (bad scheme, over the relay budget) must not take down the shell; the panel validates before
    // saving, so this is the belt for a hand-edited localStorage value.
    try { relayConfiguration.replace("discovery", next.lookupRelays); } catch { /* keep the last good tier */ }
    try { relayConfiguration.replace("super", next.backupRelays); } catch { /* keep the last good tier */ }
    try { relayConfiguration.replace("outbox", next.backupRelays); } catch { /* keep the last good tier */ }
  };
  applySettings(initial);
  const unsubscribeSettings = settings.subscribe(applySettings);
  // Follows the account's own BUD-03 list, falling back to the settings value while it is unknown.
  const serverSubscription: Subscription = blossomServers$.subscribe((servers) => {
    try { uploads.update(servers); } catch { /* keep the last good server list */ }
  });

  const accountLists = createAccountListEditor({ accounts, relayPolicy }, {
    publisher,
    // `refresh` forces a network read: editing a stale cached list would republish it and drop
    // whatever the user changed from another client.
    lookup: (kind, pubkey) => coreServices.identity.lookupReplaceable(kind, pubkey, { refresh: true }),
    publishRelays: (kind, event, previous) => kind === MAILBOX_LIST_KIND
      ? relayListPublishTargets(event, previous, [...writeRelays, ...discoveryRelays])
      : [...writeRelays]
  });

  const intentPreferences = createIntentPreferenceStore(localStorage);
  const activeAccount = (): string => accounts.publicKey || "signed-out";
  const intentResolver = registerIntentService(shell.runtime, packageStore, windows, {
    telemetry: telemetry,
    getDefaultHandler: (archetype) => intentPreferences.get(activeAccount(), archetype),
    chooseHandler: (archetype, candidates, sender) => {
      const choices = candidates.map((candidate, index) => `${index + 1}. ${candidate.title ?? candidate.dTag}`).join("\n");
      const answer = window.prompt(`${sender} wants to open ${archetype}. Choose handler:\n${choices}`);
      if (answer === null) return undefined;
      const selected = candidates[Number.parseInt(answer, 10) - 1];
      if (!selected) return undefined;
      intentPreferences.set(activeAccount(), archetype, selected.dTag);
      return selected.dTag;
    },
    authorizeExplicitHandler: (sender, handler) => window.confirm(`${sender} wants to open ${handler}. Allow?`)
  });
  const resolveManifest = createManifestResolver(discoveryRelays);
  const onMessage = (event: MessageEvent): void => {
    shell.handleMessage(event);
    windowBridge.accept(event);
    if (event.data?.type === "shell.ready" && event.source && originRegistry.getWindowId(event.source as Window)) {
      shell.publishIdentityChanged(accounts.publicKey);
      hostServices.theme.publishTheme(hostServices.theme.getCurrentTheme());
    }
  };
  window.addEventListener("message", onMessage);
  const fixtureResourceUrl = new URL(`${import.meta.env.BASE_URL}fixture-resource.txt`, location.href).href;
  const fixtureDTag = import.meta.env.VITE_INSTALL_FIXTURE === "true"
    ? await installFixture(packageStore, fixtureResourceUrl)
    : undefined;
  const builtInDTags = await installBuiltInNapplets(packageStore, import.meta.env.BASE_URL);
  for (const installedDTag of [fixtureDTag, ...builtInDTags]) {
    if (!installedDTag) continue;
    const fixture = await packageStore.getActive(installedDTag);
    if (fixture) resourcePublishers.set(resourceIdentityKey(fixture.dTag, fixture.aggregateHash), fixture.manifestEvent.pubkey);
    if (fixture && installedDTag === fixtureDTag) resourceGrants.set(resourceGrantKey(fixture.manifestEvent.pubkey, fixture.dTag, fixture.aggregateHash), [new URL(fixtureResourceUrl).origin]);
    for (const archetype of fixture?.manifest.archetypes ?? []) intentResolver.notifyChanged(archetype.slug);
  }
  if (!("serviceWorker" in navigator)) throw new Error("Service workers unavailable");
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL, type: "module" });
  const onWorkerMessage = (event: MessageEvent): void => { recordWorkerProtocolFailure(event.data, telemetry); };
  navigator.serviceWorker.addEventListener("message", onWorkerMessage);
  await navigator.serviceWorker.ready;
  if (!controlledAtStartup) {
    location.reload();
    return new Promise<BrowserPlatform>(() => {});
  }
  let fixturePending = fixtureDTag !== undefined;
  const updates = coordinateServiceWorkerUpdates(registration, navigator.serviceWorker, {
    activeWindowCount: () => (windows?.listWindowIds().length ?? 0) + (fixturePending ? 1 : 0),
    closeWindows: () => windows?.close(),
    confirmActivation: () => !fixturePending && window.confirm("Platform update ready. Close active Napplet windows and reload now?"),
    reload: () => location.reload()
  });
  const startupFixtures = [fixtureDTag].filter((dTag): dTag is string => dTag !== undefined);
  if (startupFixtures.length > 0) {
    void Promise.all(startupFixtures.map((dTag) => windows.create(dTag))).finally(() => { fixturePending = false; updates.check(); });
  }
  let closed = false;
  return {
    windows,
    connectExtension: () => accounts.connectExtension(),
    signOut: () => accounts.signOut(),
    async dockLaunchers() {
      return (await packageStore.listActive())
        .map((record) => dockLauncherFromManifest(record, discoveryRelays, import.meta.env.BASE_URL))
        .filter((launcher): launcher is DockLauncher => launcher !== undefined);
    },
    async installAndOpen(coordinate) {
      const event = await resolveManifest(coordinate);
      const installation = await installRemotePackage(packageStore, event, { allowHttpLocalhost: allowLocalPlaintext });
      resourcePublishers.set(resourceIdentityKey(installation.dTag, installation.aggregateHash), installation.manifestEvent.pubkey);
      for (const archetype of installation.manifest.archetypes ?? []) intentResolver.notifyChanged(archetype.slug);
      const managed = await windows.create(installation.dTag);
      return { dTag: installation.dTag, title: installation.manifest.title ?? installation.dTag, windowId: managed.identity.windowId };
    },
    async openInstalled(dTag) {
      const installation = await packageStore.getActive(dTag);
      if (!installation) throw new Error("No active verified installation");
      const managed = await windows.create(dTag);
      return { dTag, title: installation.manifest.title ?? dTag, windowId: managed.identity.windowId };
    },
    destroyWindow: (windowId) => windows?.destroy(windowId),
    authenticatedWindowIds: () => shell.runtime.sessionRegistry.getAllEntries().map((entry) => entry.windowId),
    telemetrySnapshot: () => telemetry.snapshot(),
    settings,
    relays: relayConfiguration,
    accountLists,
    publishTheme: (colors) => hostServices.theme.publishTheme({ colors }),
    async close() {
      if (closed) return; closed = true;
      unsubscribeSettings(); serverSubscription.unsubscribe();
      updates.close(); windows?.close(); window.removeEventListener("message", onMessage); navigator.serviceWorker.removeEventListener("message", onWorkerMessage); coreServices.close(); shell.destroy(); adapter.close(); hostServices.close(); audit.clear();
      try { await persistence.close(); }
      finally { shutdownNostrServices(); packageStore.close(); metadataStore.close(); }
      void registration;
    }
  };
}
