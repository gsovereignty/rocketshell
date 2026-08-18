import { createShellBridge, originRegistry, type ShellBridge } from "@kehto/shell";
import { createHostAuditTrail, createIntentPreferenceStore, createStorageConfigStore, registerCoreHostServices, registerIntentService, registerResourceService } from "@platform/host-services";
import { createPlatformShellAdapter, registerCoreServices } from "@platform/kehto-adapters";
import { IndexedDbPackageStore, NappletWindowManager, type WindowBridge, type WindowIdentity } from "@platform/napplet-gateway";
import { createPersistentNostrEngine } from "@platform/nostr-engine";
import { PLATFORM_REQUIRED_DOMAINS } from "@project/platform-nap-contract";
import { installFixture } from "./fixture.js";
import { createReadyRegistry } from "./ready-registry.js";

function relayUrls(raw: string | undefined): string[] { return (raw ?? "").split(",").map((url) => url.trim()).filter(Boolean); }

const WIRED_DOMAINS = new Set<string>(PLATFORM_REQUIRED_DOMAINS);
const WIRED_SERVICES = new Set(["outbox", "config", "resource", "intent", "link"]);

class BrowserWindowBridge implements WindowBridge {
  readonly #ready = createReadyRegistry();
  constructor(private readonly shell: ShellBridge) {}
  register(identity: WindowIdentity): void {
    originRegistry.register(identity.source, identity.windowId, { dTag: identity.dTag, aggregateHash: identity.aggregateHash });
    const domains = identity.requiredDomains.filter((domain) => WIRED_DOMAINS.has(domain));
    originRegistry.setEnvironment(identity.source, {
      capabilities: { domains },
      services: domains.filter((domain) => WIRED_SERVICES.has(domain))
    });
    this.#ready.register(identity.windowId);
  }
  waitUntilReady(identity: WindowIdentity): Promise<void> {
    return this.#ready.wait(identity.windowId);
  }
  accept(event: MessageEvent): void {
    if (!event.data || typeof event.data !== "object" || event.data.type !== "shell.ready") return;
    const windowId = event.source instanceof Window ? originRegistry.getWindowId(event.source) : undefined;
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
  destroyWindow(windowId: string): void;
  authenticatedWindowIds(): readonly string[];
  close(): Promise<void>;
}

export async function createBrowserPlatform(container: HTMLElement): Promise<BrowserPlatform> {
  const controlledAtStartup = navigator.serviceWorker.controller !== null;
  const discoveryRelays = relayUrls(import.meta.env.VITE_DISCOVERY_RELAYS);
  const readRelays = relayUrls(import.meta.env.VITE_READ_RELAYS);
  const writeRelays = relayUrls(import.meta.env.VITE_WRITE_RELAYS);
  const packageStore = await IndexedDbPackageStore.open();
  const engine = await createPersistentNostrEngine({ relayPolicy: { allowInsecureLocalhost: import.meta.env.DEV } });
  let windows: NappletWindowManager | undefined;
  const audit = createHostAuditTrail();
  const adapter = createPlatformShellAdapter({
    engine, discoveryRelays, readRelays, writeRelays,
    createWindow: () => null,
    intentAvailable: () => windows !== undefined,
    linkAvailable: () => true,
    advertisedServices: ["outbox", "config", "resource", "intent", "link"],
    onAclCheck: (event) => audit.recordAcl(event),
    onUnroutedMessage: (info) => audit.recordUnrouted(info)
  });
  const shell = createShellBridge(adapter);
  registerCoreServices(shell.runtime, engine, { discoveryRelays, directReadRelays: readRelays, directWriteRelays: writeRelays });
  const hostServices = registerCoreHostServices(shell.runtime, {
    openSettings: () => undefined,
    configStore: createStorageConfigStore(localStorage),
    resolveConfigScope: (windowId) => {
      const identity = windows?.findByWindowId(windowId)?.identity;
      if (!identity) return undefined;
      return `${engine.accounts.publicKey || "signed-out"}:${identity.dTag}:${identity.aggregateHash}`;
    }
  });
  registerResourceService(shell.runtime, { grants: new Map(), allowHttpLocalhost: import.meta.env.DEV });
  const windowBridge = new BrowserWindowBridge(shell);
  windows = new NappletWindowManager(packageStore, windowBridge, container, import.meta.env.BASE_URL);
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
  const onMessage = (event: MessageEvent): void => { windowBridge.accept(event); shell.handleMessage(event); };
  window.addEventListener("message", onMessage);
  const fixtureDTag = import.meta.env.VITE_INSTALL_FIXTURE === "true" ? await installFixture(packageStore) : undefined;
  if (fixtureDTag) {
    const fixture = await packageStore.getActive(fixtureDTag);
    for (const archetype of fixture?.manifest.archetypes ?? []) intentResolver.notifyChanged(archetype.slug);
  }
  if (!("serviceWorker" in navigator)) throw new Error("Service workers unavailable");
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, { scope: import.meta.env.BASE_URL, type: "module" });
  await navigator.serviceWorker.ready;
  if (!controlledAtStartup) {
    location.reload();
    return new Promise<BrowserPlatform>(() => {});
  }
  if (fixtureDTag) void windows.create(fixtureDTag);
  let closed = false;
  return {
    windows,
    destroyWindow: (windowId) => windows?.destroy(windowId),
    authenticatedWindowIds: () => shell.runtime.sessionRegistry.getAllEntries().map((entry) => entry.windowId),
    async close() {
      if (closed) return; closed = true;
      windows?.close(); window.removeEventListener("message", onMessage); shell.destroy(); adapter.close(); hostServices.close(); audit.clear(); await engine.close(); packageStore.close();
      void registration;
    }
  };
}
