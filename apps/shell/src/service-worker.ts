/// <reference lib="webworker" />
import { IndexedDbPackageStore, SERVICE_WORKER_PROTOCOL_VERSION, parseVirtualNappletUrl, parseWorkerRequest, routeNappletRequest, type WorkerReply } from "@platform/napplet-gateway/worker";

const worker = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = "platform-shell-v2";
const storePromise = IndexedDbPackageStore.open();

worker.addEventListener("install", (event: ExtendableEvent) => {
  // Waiting is intentional. Active shell coordinates activation when user work is safe.
  event.waitUntil(Promise.all([caches.open(SHELL_CACHE), storePromise]).then(() => undefined));
});

worker.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(worker.clients.claim());
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
  if (import.meta.env.DEV) {
    event.respondWith(fetch(event.request));
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
