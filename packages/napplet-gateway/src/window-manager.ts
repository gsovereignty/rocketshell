import { SubscriptionRegistry } from "@project/platform-nap-contract";
import type { PlatformDomain } from "@project/platform-nap-contract";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";
import { artifactResponse } from "./response-builder.js";
import type { PackageStore } from "./types.js";
import { virtualNappletUrl } from "./virtual-url.js";

export interface WindowIdentity {
  readonly windowId: string;
  readonly nonce: string;
  readonly dTag: string;
  readonly aggregateHash: string;
  readonly requiredDomains: readonly PlatformDomain[];
  readonly source: Window;
}

export interface WindowBridge {
  register(identity: WindowIdentity): void | Promise<void>;
  waitUntilReady(identity: WindowIdentity): Promise<void>;
  unregister(windowId: string): void;
}

export interface ManagedNappletWindow {
  readonly identity: WindowIdentity;
  readonly iframe: HTMLIFrameElement;
  readonly resources: SubscriptionRegistry;
  readonly ready: Promise<void>;
}

export class NappletWindowManager {
  readonly #windows = new Map<string, ManagedNappletWindow>();
  #closed = false;

  constructor(private readonly store: PackageStore, private readonly bridge: WindowBridge, private readonly container: HTMLElement, private readonly applicationBase: string, private readonly telemetry: PlatformTelemetry = NOOP_TELEMETRY) {}

  findByDTag(dTag: string): ManagedNappletWindow | undefined {
    return [...this.#windows.values()].find((window) => window.identity.dTag === dTag);
  }

  findByWindowId(windowId: string): ManagedNappletWindow | undefined {
    return this.#windows.get(windowId);
  }

  listWindowIds(): readonly string[] {
    return Object.freeze([...this.#windows.keys()]);
  }

  async create(dTag: string): Promise<ManagedNappletWindow> {
    if (this.#closed) throw new Error("Window manager closed");
    const installation = await this.store.getActive(dTag);
    if (!installation) throw new Error("No active verified installation");
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.title = dTag;
    const windowId = crypto.randomUUID(); const nonce = crypto.randomUUID();
    this.container.append(iframe);
    const source = iframe.contentWindow;
    if (!source) { iframe.remove(); throw new Error("Iframe browsing context unavailable"); }
    const identity: WindowIdentity = { windowId, nonce, dTag: installation.dTag, aggregateHash: installation.aggregateHash, requiredDomains: installation.manifest.requires, source };
    try {
      await this.bridge.register(identity);
      // Fetch occurs under controlled shell client. Opaque iframe navigations bypass
      // service-worker routing in Chromium, so verified response becomes srcdoc.
      const virtualUrl = virtualNappletUrl(this.applicationBase, identity.dTag, identity.aggregateHash, installation.manifest.entrypoint);
      let response: Response;
      try {
        response = await fetch(virtualUrl, { cache: "no-store", credentials: "same-origin" });
      } catch {
        const artifact = installation.artifacts.find((item) => item.path === installation.manifest.entrypoint);
        if (!artifact) throw new Error("Verified Napplet entrypoint unavailable");
        const hostUrl = typeof location === "undefined" ? "http://localhost/" : location.href;
        response = artifactResponse(artifact, installation.namespacePrelude, new URL("./", new URL(virtualUrl, hostUrl)).href, installation.artifacts);
      }
      if (!response.ok || !response.headers.get("content-security-policy")) throw new Error("Verified Napplet response unavailable");
      iframe.dataset.virtualUrl = virtualUrl;
      // Navigation occurs only after authenticated identity registration.
      iframe.srcdoc = await response.text();
      const ready = this.bridge.waitUntilReady(identity);
      const managed = { identity, iframe, resources: new SubscriptionRegistry(), ready };
      this.#windows.set(windowId, managed);
      this.telemetry.record("window.active", 1, { dTag: identity.dTag });
      await ready;
      return managed;
    } catch (error) {
      if (this.#windows.delete(windowId)) this.telemetry.record("window.active", -1, { dTag: installation.dTag });
      this.bridge.unregister(windowId); iframe.remove(); throw error;
    }
  }

  destroy(windowId: string): void {
    const managed = this.#windows.get(windowId);
    if (!managed) return;
    this.#windows.delete(windowId);
    managed.resources.close(); this.bridge.unregister(windowId); managed.iframe.remove();
    this.telemetry.record("window.active", -1, { dTag: managed.identity.dTag });
    this.telemetry.record("subscription.cleanup", 1, { operation: "window-destroy" });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const windowId of [...this.#windows.keys()]) this.destroy(windowId);
  }
}
