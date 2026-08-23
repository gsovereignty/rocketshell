import { ResourceServiceError, createResourceService, type ResourceInfo } from "@kehto/services";
import type { Runtime } from "@kehto/runtime";
import { NOOP_TELEMETRY, type PlatformTelemetry } from "@project/platform-nap-contract";

export interface ResourcePolicy {
  readonly maximumBytes?: number;
  readonly timeoutMs?: number;
  readonly allowedMimeTypes?: readonly string[];
  readonly allowHttpLocalhost?: boolean;
  readonly telemetry?: PlatformTelemetry;
}

const isLocalhost = (hostname: string): boolean => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

function validateUrl(raw: string, allowHttpLocalhost: boolean): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ResourceServiceError("unsupported-scheme", "Invalid resource URL"); }
  if (url.username || url.password || url.hash) throw new ResourceServiceError("blocked-by-policy", "Resource URL contains forbidden components");
  if (url.protocol !== "https:" && !(allowHttpLocalhost && url.protocol === "http:" && isLocalhost(url.hostname))) throw new ResourceServiceError("unsupported-scheme", "Resource URL scheme denied");
  return url;
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp") return "video/mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return "application/octet-stream";
}

export function createPolicyFetch(policy: ResourcePolicy): (url: string, init: { method?: string; headers?: Record<string, string>; signal: AbortSignal }) => Promise<Response> {
  const maximumBytes = policy.maximumBytes ?? 8 * 1024 * 1024; const timeoutMs = policy.timeoutMs ?? 10_000;
  const allowedMimeTypes = new Set(policy.allowedMimeTypes ?? ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "application/octet-stream"]);
  const telemetry = policy.telemetry ?? NOOP_TELEMETRY;
  return async (raw, init) => {
    const controller = new AbortController(); const abort = () => controller.abort(); init.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const initial = validateUrl(raw, policy.allowHttpLocalhost ?? false);
      const headers = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([name]) => !["authorization", "cookie", "proxy-authorization"].includes(name.toLowerCase())));
      // Browsers expose a cross-origin manual redirect only as an opaque status-0
      // response. Follow without ambient credentials, then validate final URL.
      const response = await fetch(initial, { method: init.method ?? "GET", headers, signal: controller.signal, redirect: "follow", credentials: "omit", referrerPolicy: "no-referrer" });
      if (response.url) validateUrl(response.url, policy.allowHttpLocalhost ?? false);
      if (!response.ok || !response.body) throw new ResourceServiceError("network-error", "Resource request failed");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      while (true) {
        const item = await reader.read(); if (item.done) break;
        total += item.value.byteLength; if (total > maximumBytes) { await reader.cancel(); throw new ResourceServiceError("too-large", "Resource exceeds byte limit"); }
        chunks.push(item.value);
      }
      const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const mime = sniffMime(bytes); if (!allowedMimeTypes.has(mime)) throw new ResourceServiceError("decode-failed", "Resource media type denied");
      telemetry.record("resource.bytes", total, { mime });
      return new Response(bytes, { status: 200, headers: { "Content-Type": mime, "Content-Length": String(total) } });
    } catch (error) {
      if (error instanceof ResourceServiceError) { telemetry.record("resource.denied", 1, { reason: error.code }); throw error; }
      if (controller.signal.aborted) { telemetry.record("resource.timeout", 1); throw new ResourceServiceError("timeout", "Resource request timed out"); }
      throw new ResourceServiceError("network-error", "Resource request failed");
    } finally { clearTimeout(timeout); init.signal.removeEventListener("abort", abort); }
  };
}

export function registerResourceService(runtime: Runtime, policy: ResourcePolicy): void {
  const info: ResourceInfo = { schemes: [{ scheme: "https", enabled: true }, { scheme: "http", enabled: policy.allowHttpLocalhost ?? false }], maxBytes: policy.maximumBytes ?? 8 * 1024 * 1024, maxUrls: 8 };
  runtime.registerService("resource", createResourceService({
    fetch: createPolicyFetch(policy),
    isOriginGranted: () => true,
    getConnectGrants: () => [],
    resolveIdentity: (windowId) => {
      const entry = runtime.sessionRegistry.getEntryByWindowId(windowId);
      return entry ? { dTag: entry.dTag, aggregateHash: entry.aggregateHash } : null;
    },
    resourceInfo: info
  }));
}
