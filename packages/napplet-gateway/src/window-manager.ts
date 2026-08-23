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
  launch?: WindowLaunchDescriptor;
  replacesWindowId?: string;
}

export type WindowLaunchDescriptor =
  | { readonly type: "direct"; readonly coordinate: string }
  | { readonly type: "intent"; readonly sender: string; readonly convention: string; readonly payload?: unknown };

export interface CreateWindowOptions {
  readonly deferLayout?: boolean;
}

export class NappletWindowManager {
  readonly #windows = new Map<string, ManagedNappletWindow>();
  readonly #creating = new Map<string, Promise<ManagedNappletWindow>>();
  readonly #changeListeners = new Set<() => void>();
  #focusedWindowId: string | undefined;
  #closed = false;

  constructor(private readonly store: PackageStore, private readonly bridge: WindowBridge, private readonly container: HTMLElement, private readonly applicationBase: string, private readonly telemetry: PlatformTelemetry = NOOP_TELEMETRY, private readonly readyTimeoutMs = 10_000) {}

  findByDTag(dTag: string, aggregateHash?: string): ManagedNappletWindow | undefined {
    return [...this.#windows.values()].find((window) =>
      window.identity.dTag === dTag
      && (aggregateHash === undefined || window.identity.aggregateHash === aggregateHash));
  }

  findByWindowId(windowId: string): ManagedNappletWindow | undefined {
    return this.#windows.get(windowId);
  }

  listWindowIds(): readonly string[] {
    return Object.freeze([...this.#windows.keys()]);
  }

  get focusedWindowId(): string | undefined { return this.#focusedWindowId; }

  setLaunchDescriptor(windowId: string, launch: WindowLaunchDescriptor): void {
    const managed = this.#windows.get(windowId);
    if (!managed) return;
    managed.launch = launch;
    this.#notifyWindowsChanged();
  }

  onWindowsChanged(listener: () => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  show(windowId: string): void {
    const target = this.#windows.get(windowId);
    if (!target) return;
    target.element.hidden = false;
    delete target.element.dataset.layoutPending;
    this.#notifyWindowsChanged();
  }

  focus(windowId: string, callerWindowId?: string): void {
    const target = this.#windows.get(windowId);
    if (!target) return;
    this.#focusedWindowId = windowId;
    if (callerWindowId && callerWindowId !== windowId) {
      const caller = this.#windows.get(callerWindowId);
      if (caller) {
        target.element.style.gridColumn = caller.element.style.gridColumn;
        target.element.style.gridRow = caller.element.style.gridRow;
        target.replacesWindowId = callerWindowId;
        target.element.dataset.replacesWindowId = callerWindowId;
        caller.element.hidden = true;
        target.element.hidden = false;
        delete target.element.dataset.layoutPending;
      }
    } else if (!callerWindowId) {
      for (const [candidateId, candidate] of this.#windows) candidate.element.hidden = candidateId !== windowId;
    }
    target.iframe.focus();
    this.#notifyWindowsChanged();
  }

  #notifyWindowsChanged(): void {
    for (const listener of this.#changeListeners) listener();
  }

  async create(dTag: string, reusePending = true, options: CreateWindowOptions = {}): Promise<ManagedNappletWindow> {
    if (this.#closed) throw new Error("Window manager closed");
    const pending = reusePending ? this.#creating.get(dTag) : undefined;
    if (pending) return pending;
    const creating = this.#create(dTag, options);
    if (reusePending) this.#creating.set(dTag, creating);
    try { return await creating; }
    finally { if (reusePending && this.#creating.get(dTag) === creating) this.#creating.delete(dTag); }
  }

  async #create(dTag: string, options: CreateWindowOptions): Promise<ManagedNappletWindow> {
    const installation = await this.store.getActive(dTag);
    if (!installation) throw new Error("No active verified installation");
    const element = document.createElement("article");
    element.className = "napplet-window";
    element.hidden = true;
    element.dataset.startupPending = "true";
    element.dataset.layoutPending = "true";
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
    const fullscreenButton = document.createElement("button");
    fullscreenButton.className = "napplet-window-fullscreen";
    fullscreenButton.type = "button";
    fullscreenButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"></path></svg>';
    fullscreenButton.setAttribute("aria-label", `Fullscreen ${title.textContent}`);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.title = dTag;
    const windowId = crypto.randomUUID(); const nonce = crypto.randomUUID();
    element.dataset.windowId = windowId;
    closeButton.dataset.windowId = windowId;
    closeButton.addEventListener("click", () => this.destroy(windowId));
    toolbar.append(title, fullscreenButton, closeButton);
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
      iframe.onload = () => {
        iframe.onload = null;
        delete element.dataset.startupPending;
        if (!options.deferLayout) {
          element.hidden = false;
          delete element.dataset.layoutPending;
        }
      };
      iframe.srcdoc = await response.text();
      const bridgeReady = this.bridge.waitUntilReady(identity);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const ready = Promise.race([
        bridgeReady,
        new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Napplet readiness timed out")), this.readyTimeoutMs);
        })
      ]).finally(() => { if (timeout !== undefined) clearTimeout(timeout); });
      const managed: ManagedNappletWindow = { identity, element, iframe, resources: new SubscriptionRegistry(), ready };
      this.#windows.set(windowId, managed);
      this.#notifyWindowsChanged();
      this.telemetry.record("window.active", 1, { dTag: identity.dTag });
      await ready;
      return managed;
    } catch (error) {
      iframe.onload = null;
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
    const replacedWindowId = managed.replacesWindowId;
    const replaced = replacedWindowId ? this.#windows.get(replacedWindowId) : undefined;
    if (replaced) {
      replaced.element.style.gridColumn = managed.element.style.gridColumn;
      replaced.element.style.gridRow = managed.element.style.gridRow;
      replaced.element.dataset.replacesWindowId = windowId;
      replaced.element.hidden = false;
      delete replaced.element.dataset.layoutPending;
    }
    managed.resources.close(); this.bridge.unregister(windowId); managed.element.remove();
    if (this.#focusedWindowId === windowId) {
      this.#focusedWindowId = replaced?.identity.windowId;
      if (!replaced) for (const candidate of this.#windows.values()) candidate.element.hidden = false;
    }
    this.#notifyWindowsChanged();
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
