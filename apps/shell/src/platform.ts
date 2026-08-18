import { createShellBridge, originRegistry, type ShellBridge } from "@kehto/shell";
import { createStorageConfigStore, registerCoreHostServices, registerIntentService, registerResourceService } from "@platform/host-services";
import { createPlatformShellAdapter, registerCoreServices } from "@platform/kehto-adapters";
import { IndexedDbPackageStore, NappletWindowManager, type WindowBridge, type WindowIdentity } from "@platform/napplet-gateway";
import { createPersistentNostrEngine } from "@platform/nostr-engine";
import { installFixture } from "./fixture.js";
import { createReadyRegistry } from "./ready-registry.js";

function relayUrls(raw: string | undefined): string[] { return (raw ?? "").split(",").map((url) => url.trim()).filter(Boolean); }

class BrowserWindowBridge implements WindowBridge {
  readonly #ready = createReadyRegistry();
  constructor(private readonly shell: ShellBridge) {}
  register(identity: WindowIdentity): void {
    originRegistry.register(identity.source, identity.windowId, { dTag: identity.dTag, aggregateHash: identity.aggregateHash });
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
    this.#ready.remove(windowId); this.shell.runtime.destroyWindow(windowId); originRegistry.unregister(windowId);
  }
}

export interface BrowserPlatform { readonly windows: NappletWindowManager; close(): Promise<void> }

export async function createBrowserPlatform(container: HTMLElement): Promise<BrowserPlatform> {
  const controlledAtStartup = navigator.serviceWorker.controller !== null;
  const discoveryRelays = relayUrls(import.meta.env.VITE_DISCOVERY_RELAYS);
  const readRelays = relayUrls(import.meta.env.VITE_READ_RELAYS);
  const writeRelays = relayUrls(import.meta.env.VITE_WRITE_RELAYS);
  const packageStore = await IndexedDbPackageStore.open();
  const engine = await createPersistentNostrEngine({ relayPolicy: { allowInsecureLocalhost: import.meta.env.DEV } });
  let windows: NappletWindowManager | undefined;
  const adapter = createPlatformShellAdapter({
    engine, discoveryRelays, readRelays, writeRelays,
    createWindow: () => null,
    intentAvailable: () => windows !== undefined,
    linkAvailable: () => true,
    advertisedServices: ["config", "resource", "intent", "link"]
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
  registerIntentService(shell.runtime, packageStore, windows, {
    getDefaultHandler: (archetype) => localStorage.getItem(`platform:intent-default:${archetype}`) ?? undefined
  });
  const onMessage = (event: MessageEvent): void => { windowBridge.accept(event); shell.handleMessage(event); };
  window.addEventListener("message", onMessage);
  const fixtureDTag = import.meta.env.VITE_INSTALL_FIXTURE === "true" ? await installFixture(packageStore) : undefined;
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
    async close() {
      if (closed) return; closed = true;
      windows?.close(); window.removeEventListener("message", onMessage); shell.destroy(); hostServices.close(); await engine.close(); packageStore.close();
      void registration;
    }
  };
}
