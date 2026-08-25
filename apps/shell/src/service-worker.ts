/// <reference lib="webworker" />
import { IndexedDbPackageStore, SERVICE_WORKER_PROTOCOL_VERSION, parseVirtualNappletUrl, parseWorkerRequest, routeNappletRequest, type WorkerReply } from "@platform/napplet-gateway/worker";
import { isBuiltInNappletRequest, isRetiredShellCache, isShellNavigationRequest, shellCacheName } from "./service-worker-cache";

declare const __SHELL_BUILD_ID__: string;

const worker = self as unknown as ServiceWorkerGlobalScope;
// Vite's dev middleware transforms this module without applying config-level
// `define` replacements. Production replaces the build constant; development
// uses a fixed cache that never serves requests because its fetch path is network-only.
const SHELL_CACHE = shellCacheName(import.meta.env.DEV ? "development" : __SHELL_BUILD_ID__);
const storePromise = IndexedDbPackageStore.open();

worker.addEventListener("install", (event: ExtendableEvent) => {
  // Waiting is intentional. Active shell coordinates activation when user work is safe.
  event.waitUntil(Promise.all([caches.open(SHELL_CACHE), storePromise]).then(() => undefined));
});

worker.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(Promise.all([
    worker.clients.claim(),
    caches.keys().then((names) => Promise.all(names
      .filter((name) => isRetiredShellCache(name, SHELL_CACHE))
      .map((name) => caches.delete(name))))
  ]).then(() => undefined));
});

worker.addEventListener("message", (event: ExtendableMessageEvent) => {
  const requestId = event.data && typeof event.data === "object" && typeof event.data.requestId === "string" ? event.data.requestId : "unknown";
  const request = parseWorkerRequest(event.data);
  const reply = (value: WorkerReply): void => { if (event.source && "postMessage" in event.source) event.source.postMessage(value); };
  if (!request) {
    const unsupported = event.data?.protocolVersion !== SERVICE_WORKER_PROTOCOL_VERSION;
    reply({ protocolVersion: SERVICE_WORKER_PROTOCOL_VERSION, requestId, ok: false, error: unsupported ? "unsupported-protocol" : "invalid-request" });
    return;
  }
  if (request.type === "ACTIVATE_UPDATE") {
    event.waitUntil(worker.skipWaiting().then(() => reply({ protocolVersion: SERVICE_WORKER_PROTOCOL_VERSION, requestId, ok: true })));
    return;
  }
  reply({ protocolVersion: SERVICE_WORKER_PROTOCOL_VERSION, requestId, ok: true });
});

worker.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== worker.location.origin) return;
  const scopePath = new URL(worker.registration.scope).pathname;
  if (parseVirtualNappletUrl(requestUrl, scopePath)) {
    event.respondWith(storePromise.then((store) => routeNappletRequest(event.request, scopePath, store)).then((response) => response ?? new Response("Not found", { status: 404 })));
    return;
  }
  if (isBuiltInNappletRequest(requestUrl.pathname, scopePath)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }
  if (import.meta.env.DEV) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (isShellNavigationRequest(requestUrl.pathname, scopePath)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        console.warn("Shell navigation network request failed; using cached shell", { pathname: requestUrl.pathname, error });
        return await caches.match(event.request) ?? new Response("Shell unavailable", { status: 503 });
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then(async (cached) => {
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  }));
});
