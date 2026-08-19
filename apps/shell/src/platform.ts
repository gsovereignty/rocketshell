import { createShellBridge, originRegistry, type ShellBridge } from "@kehto/shell";
import { createHostAuditTrail, createIntentPreferenceStore, createStorageConfigStore, registerCoreHostServices, registerIntentService, registerLinkService, registerResourceService, registerUploadService, resourceGrantKey } from "@platform/host-services";
import { createManifestResolver, createPlatformShellAdapter, createRelayConfiguration, registerCoreServices } from "@platform/kehto-adapters";
import { IndexedDbPackageStore, NappletWindowManager, installRemotePackage, type WindowBridge, type WindowIdentity } from "@platform/napplet-gateway";
import { createPersistentNostrEngine } from "@platform/nostr-engine";
import { PLATFORM_REQUIRED_DOMAINS, type PlatformMetricRecord } from "@project/platform-nap-contract";
import { installBuiltFixture, installFixture } from "./fixture.js";
import { createReadyRegistry } from "./ready-registry.js";
import { coordinateServiceWorkerUpdates, recordWorkerProtocolFailure } from "./service-worker-update.js";
import { PlatformMetadataStore } from "./platform-metadata.js";
import { requireWiredDomains } from "./domain-environment.js";

const DEFAULT_DISCOVERY_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"] as const;
const DEFAULT_NETWORK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol"] as const;

declare const __STLSTR_FIXTURE__: { readonly manifest: string; readonly indexHtml: string } | undefined;

function relayUrls(raw: string | undefined, defaults: readonly string[]): string[] {
  const configured = (raw ?? "").split(",").map((url) => url.trim()).filter(Boolean);
  return configured.length > 0 ? configured : [...defaults];
}

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
  readonly activeAccountPubkey: string;
  activeAccountProfile(): Promise<{ readonly name?: string; readonly displayName?: string; readonly picture?: string } | null>;
  connectExtension(): Promise<string>;
  signOut(): void;
  installAndOpen(coordinate: string): Promise<{ readonly dTag: string; readonly title: string; readonly windowId: string }>;
  destroyWindow(windowId: string): void;
  authenticatedWindowIds(): readonly string[];
  telemetrySnapshot(): readonly PlatformMetricRecord[];
  close(): Promise<void>;
}

export async function createBrowserPlatform(container: HTMLElement): Promise<BrowserPlatform> {
  const controlledAtStartup = navigator.serviceWorker.controller !== null;
  const allowLocalPlaintext = import.meta.env.DEV || location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]";
  const discoveryRelays = relayUrls(import.meta.env.VITE_DISCOVERY_RELAYS, DEFAULT_DISCOVERY_RELAYS);
  const readRelays = relayUrls(import.meta.env.VITE_READ_RELAYS, DEFAULT_NETWORK_RELAYS);
  const writeRelays = relayUrls(import.meta.env.VITE_WRITE_RELAYS, DEFAULT_NETWORK_RELAYS);
  const blossomServers = relayUrls(import.meta.env.VITE_BLOSSOM_SERVERS, []);
  const metadataStore = await PlatformMetadataStore.open();
  const packageStore = await IndexedDbPackageStore.open();
  const engine = await createPersistentNostrEngine({ relayPolicy: { allowInsecureLocalhost: import.meta.env.DEV } });
  const relayConfiguration = createRelayConfiguration(engine.relayPolicy, { discovery: discoveryRelays, super: readRelays, outbox: writeRelays });
  let windows: NappletWindowManager | undefined;
  const audit = createHostAuditTrail({ telemetry: engine.telemetry });
  const adapter = createPlatformShellAdapter({
    engine, discoveryRelays, readRelays, writeRelays, relayConfiguration,
    createWindow: () => null,
    intentAvailable: () => windows !== undefined,
    linkAvailable: () => true,
    advertisedServices: ["outbox", "config", "resource", "intent", "link"],
    onAclCheck: (event) => audit.recordAcl(event),
    onUnroutedMessage: (info) => audit.recordUnrouted(info)
  });
  const shell = createShellBridge(adapter);
  const coreServices = registerCoreServices(shell, engine, { discoveryRelays, directReadRelays: readRelays, directWriteRelays: writeRelays, relayConfiguration });
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
      return `${engine.accounts.publicKey || "signed-out"}:${identity.dTag}:${identity.aggregateHash}`;
    }
  });
  const resourceGrants = new Map<string, readonly string[]>();
  const resourcePublishers = new Map<string, string>();
  const resourceIdentityKey = (dTag: string, hash: string): string => `${dTag}\0${hash}`;
  registerResourceService(shell.runtime, {
    grants: resourceGrants,
    resolvePublisher: (dTag, hash) => resourcePublishers.get(resourceIdentityKey(dTag, hash)),
    allowHttpLocalhost: allowLocalPlaintext,
    telemetry: engine.telemetry
  });
  registerLinkService(shell.runtime, {
    allowHttpLocalhost: allowLocalPlaintext,
    confirm: (_windowId, url) => window.confirm(`Open ${url.href} in a new tab?`),
    openExternal: (url) => window.open(url.href, "_blank", "noopener,noreferrer") !== null
  });
  const wiredDomains = new Set<string>(PLATFORM_REQUIRED_DOMAINS);
  const wiredServices = new Set(["outbox", "config", "resource", "intent", "link"]);
  if (blossomServers.length > 0) {
    registerUploadService(shell.runtime, { blossomServers, signEvent: (template) => engine.accounts.sign(template) });
    wiredDomains.add("upload"); wiredServices.add("upload");
  }
  const windowBridge = new BrowserWindowBridge(shell, wiredDomains, wiredServices);
  windows = new NappletWindowManager(packageStore, windowBridge, container, import.meta.env.BASE_URL, engine.telemetry);
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
  const intentPreferences = createIntentPreferenceStore(localStorage);
  const activeAccount = (): string => engine.accounts.publicKey || "signed-out";
  const intentResolver = registerIntentService(shell.runtime, packageStore, windows, {
    telemetry: engine.telemetry,
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
  const resolveManifest = createManifestResolver(engine, discoveryRelays);
  const onMessage = (event: MessageEvent): void => {
    shell.handleMessage(event);
    windowBridge.accept(event);
    if (event.data?.type === "shell.ready" && event.source && originRegistry.getWindowId(event.source as Window)) {
      shell.publishIdentityChanged(engine.accounts.publicKey);
      hostServices.theme.publishTheme(hostServices.theme.getCurrentTheme());
    }
  };
  window.addEventListener("message", onMessage);
  const fixtureResourceUrl = new URL(`${import.meta.env.BASE_URL}fixture-resource.txt`, location.href).href;
  const fixtureDTag = import.meta.env.VITE_INSTALL_FIXTURE === "true"
    ? await installFixture(packageStore, fixtureResourceUrl)
    : undefined;
  const stlstrFixtureDTag = import.meta.env.VITE_INSTALL_STLSTR_FIXTURE === "true" && __STLSTR_FIXTURE__
    ? await installBuiltFixture(packageStore, __STLSTR_FIXTURE__.manifest, __STLSTR_FIXTURE__.indexHtml)
    : undefined;
  for (const installedDTag of [fixtureDTag, stlstrFixtureDTag]) {
    if (!installedDTag) continue;
    const fixture = await packageStore.getActive(installedDTag);
    if (fixture) resourcePublishers.set(resourceIdentityKey(fixture.dTag, fixture.aggregateHash), fixture.manifestEvent.pubkey);
    if (fixture && installedDTag === fixtureDTag) resourceGrants.set(resourceGrantKey(fixture.manifestEvent.pubkey, fixture.dTag, fixture.aggregateHash), [new URL(fixtureResourceUrl).origin]);
    for (const archetype of fixture?.manifest.archetypes ?? []) intentResolver.notifyChanged(archetype.slug);
  }
  if (!("serviceWorker" in navigator)) throw new Error("Service workers unavailable");
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL, type: "module" });
  const onWorkerMessage = (event: MessageEvent): void => { recordWorkerProtocolFailure(event.data, engine.telemetry); };
  navigator.serviceWorker.addEventListener("message", onWorkerMessage);
  await navigator.serviceWorker.ready;
  if (!controlledAtStartup) {
    location.reload();
    return new Promise<BrowserPlatform>(() => {});
  }
  let fixturePending = fixtureDTag !== undefined || stlstrFixtureDTag !== undefined;
  const updates = coordinateServiceWorkerUpdates(registration, navigator.serviceWorker, {
    activeWindowCount: () => (windows?.listWindowIds().length ?? 0) + (fixturePending ? 1 : 0),
    closeWindows: () => windows?.close(),
    confirmActivation: () => !fixturePending && window.confirm("Platform update ready. Close active Napplet windows and reload now?"),
    reload: () => location.reload()
  });
  const startupFixtures = [fixtureDTag, stlstrFixtureDTag].filter((dTag): dTag is string => dTag !== undefined);
  if (startupFixtures.length > 0) {
    void Promise.all(startupFixtures.map((dTag) => windows.create(dTag))).finally(() => { fixturePending = false; updates.check(); });
  }
  let closed = false;
  return {
    windows,
    get activeAccountPubkey() { return engine.accounts.publicKey; },
    activeAccountProfile: () => coreServices.identity.getProfile(engine.accounts.publicKey),
    connectExtension: () => engine.accounts.connectExtension(),
    signOut: () => engine.accounts.signOut(),
    async installAndOpen(coordinate) {
      const event = await resolveManifest(coordinate);
      const installation = await installRemotePackage(packageStore, event, { allowHttpLocalhost: allowLocalPlaintext });
      resourcePublishers.set(resourceIdentityKey(installation.dTag, installation.aggregateHash), installation.manifestEvent.pubkey);
      for (const archetype of installation.manifest.archetypes ?? []) intentResolver.notifyChanged(archetype.slug);
      const managed = await windows.create(installation.dTag);
      return { dTag: installation.dTag, title: installation.manifest.title ?? installation.dTag, windowId: managed.identity.windowId };
    },
    destroyWindow: (windowId) => windows?.destroy(windowId),
    authenticatedWindowIds: () => shell.runtime.sessionRegistry.getAllEntries().map((entry) => entry.windowId),
    telemetrySnapshot: () => engine.telemetry.snapshot(),
    async close() {
      if (closed) return; closed = true;
      updates.close(); windows?.close(); window.removeEventListener("message", onMessage); navigator.serviceWorker.removeEventListener("message", onWorkerMessage); coreServices.close(); shell.destroy(); adapter.close(); hostServices.close(); audit.clear();
      try { await engine.close(); }
      finally { packageStore.close(); metadataStore.close(); }
      void registration;
    }
  };
}
