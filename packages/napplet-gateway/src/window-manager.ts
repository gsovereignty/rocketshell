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
  readonly element: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  readonly resources: SubscriptionRegistry;
  readonly ready: Promise<void>;
}

export class NappletWindowManager {
  readonly #windows = new Map<string, ManagedNappletWindow>();
  readonly #creating = new Map<string, Promise<ManagedNappletWindow>>();
  readonly #changeListeners = new Set<() => void>();
  #closed = false;

  constructor(private readonly store: PackageStore, private readonly bridge: WindowBridge, private readonly container: HTMLElement, private readonly applicationBase: string, private readonly telemetry: PlatformTelemetry = NOOP_TELEMETRY, private readonly readyTimeoutMs = 10_000) {}

  findByDTag(dTag: string): ManagedNappletWindow | undefined {
    return [...this.#windows.values()].find((window) => window.identity.dTag === dTag);
  }

  findByWindowId(windowId: string): ManagedNappletWindow | undefined {
    return this.#windows.get(windowId);
  }

  listWindowIds(): readonly string[] {
    return Object.freeze([...this.#windows.keys()]);
  }

  onWindowsChanged(listener: () => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  #notifyWindowsChanged(): void {
    for (const listener of this.#changeListeners) listener();
  }

  async create(dTag: string, reusePending = true): Promise<ManagedNappletWindow> {
    if (this.#closed) throw new Error("Window manager closed");
    const pending = reusePending ? this.#creating.get(dTag) : undefined;
    if (pending) return pending;
    const creating = this.#create(dTag);
    if (reusePending) this.#creating.set(dTag, creating);
    try { return await creating; }
    finally { if (reusePending && this.#creating.get(dTag) === creating) this.#creating.delete(dTag); }
  }

  async #create(dTag: string): Promise<ManagedNappletWindow> {
    const installation = await this.store.getActive(dTag);
    if (!installation) throw new Error("No active verified installation");
    const element = document.createElement("article");
    element.className = "napplet-window";
    const toolbar = document.createElement("header");
    toolbar.className = "napplet-window-toolbar";
    const title = document.createElement("span");
    title.className = "napplet-window-title";
    title.textContent = installation.manifest.title ?? installation.dTag;
    const closeButton = document.createElement("button");
    closeButton.className = "napplet-window-close";
    closeButton.type = "button";
    closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>';
    closeButton.setAttribute("aria-label", `Close ${title.textContent}`);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.title = dTag;
    const windowId = crypto.randomUUID(); const nonce = crypto.randomUUID();
    closeButton.dataset.windowId = windowId;
    closeButton.addEventListener("click", () => this.destroy(windowId));
    toolbar.append(title, closeButton);
    element.append(toolbar, iframe);
    this.container.append(element);
    const source = iframe.contentWindow;
    if (!source) { element.remove(); throw new Error("Iframe browsing context unavailable"); }
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
      const bridgeReady = this.bridge.waitUntilReady(identity);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const ready = Promise.race([
        bridgeReady,
        new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Napplet readiness timed out")), this.readyTimeoutMs);
        })
      ]).finally(() => { if (timeout !== undefined) clearTimeout(timeout); });
      const managed = { identity, element, iframe, resources: new SubscriptionRegistry(), ready };
      this.#windows.set(windowId, managed);
      this.#notifyWindowsChanged();
      this.telemetry.record("window.active", 1, { dTag: identity.dTag });
      await ready;
      return managed;
    } catch (error) {
      if (this.#windows.delete(windowId)) {
        this.#notifyWindowsChanged();
        this.telemetry.record("window.active", -1, { dTag: installation.dTag });
      }
      this.bridge.unregister(windowId); element.remove(); throw error;
    }
  }

  destroy(windowId: string): void {
    const managed = this.#windows.get(windowId);
    if (!managed) return;
    this.#windows.delete(windowId);
    this.#notifyWindowsChanged();
    managed.resources.close(); this.bridge.unregister(windowId); managed.element.remove();
    this.telemetry.record("window.active", -1, { dTag: managed.identity.dTag });
    this.telemetry.record("subscription.cleanup", 1, { operation: "window-destroy" });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const windowId of [...this.#windows.keys()]) this.destroy(windowId);
    this.#changeListeners.clear();
  }
}
