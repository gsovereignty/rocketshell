import type { StoredArtifact } from "./types.js";

export const NAPPLET_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const escapeAttribute = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");

const SEALED_GLOBALS = ["nostr", "fetch", "WebSocket", "EventSource", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "caches", "__platformTestSignEvent"] as const;
const sealedGlobalsPrelude = `<script>(()=>{for(const key of ${JSON.stringify(SEALED_GLOBALS)}){try{Object.defineProperty(globalThis,key,{value:undefined,writable:false,configurable:false})}catch{try{globalThis[key]=undefined}catch{}}}})();</script>`;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

const dataUrl = (artifact: Pick<StoredArtifact, "bytes" | "mediaType">): string => `data:${artifact.mediaType};base64,${toBase64(artifact.bytes)}`;
const isText = (artifact: StoredArtifact, types: readonly string[]): boolean => types.includes(artifact.mediaType.split(";", 1)[0]!.trim().toLowerCase());

function projectArtifacts(artifacts: readonly StoredArtifact[], assetBaseUrl: string): { readonly imports: Record<string, string>; rewrite(value: string, sourceUrl: string, preserveModuleUrls?: boolean): string } {
  const byUrl = new Map(artifacts.map((item) => [new URL(item.path, assetBaseUrl).href, item]));
  const projected = new Map<string, string>();
  const rewrite = (value: string, sourceUrl: string, preserveModuleUrls = false): string => value.replace(/(["'])(\.\.?\/[^"']+)\1/g, (match, quote: string, specifier: string) => {
    const resolved = new URL(specifier, sourceUrl).href;
    const target = byUrl.get(resolved);
    if (!target) return match;
    const targetType = target.mediaType.split(";", 1)[0]!.trim().toLowerCase();
    const isModule = targetType === "text/javascript" || targetType === "application/javascript";
    return `${quote}${isModule && preserveModuleUrls ? resolved : projected.get(resolved) ?? dataUrl(target)}${quote}`;
  });
  for (const [url, item] of byUrl) {
    const bytes = isText(item, ["text/javascript", "application/javascript", "text/css"])
      ? new TextEncoder().encode(rewrite(new TextDecoder().decode(item.bytes), url, true))
      : item.bytes;
    projected.set(url, dataUrl({ bytes, mediaType: item.mediaType }));
  }
  const imports = Object.fromEntries([...byUrl.entries()]
    .filter(([, item]) => isText(item, ["text/javascript", "application/javascript"]))
    .map(([url]) => [url, projected.get(url)!]));
  return { imports, rewrite };
}

export function artifactResponse(artifact: StoredArtifact, namespacePrelude = "", assetBaseUrl?: string, artifacts: readonly StoredArtifact[] = []): Response {
  let body: BodyInit = artifact.bytes.slice().buffer;
  let csp = NAPPLET_CSP;
  if (artifact.mediaType.split(";", 1)[0]?.trim().toLowerCase() === "text/html") {
    const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    const html = new TextDecoder().decode(artifact.bytes);
    const prelude = `${sealedGlobalsPrelude}${namespacePrelude}`;
    const nonceScripts = (value: string): string => value.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
    csp = NAPPLET_CSP.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
    const base = assetBaseUrl ? `<base href="${escapeAttribute(assetBaseUrl)}">` : "";
    let authored = html;
    let importMap = "";
    if (assetBaseUrl) {
      const projection = projectArtifacts(artifacts, assetBaseUrl);
      authored = projection.rewrite(html, new URL(artifact.path, assetBaseUrl).href);
      importMap = `<script type="importmap">${JSON.stringify({ imports: projection.imports }).replaceAll("<", "\\u003c")}</script>`;
      csp = csp
        .replace("script-src 'self'", "script-src 'self' data:")
        .replace("style-src 'self'", "style-src 'self' data:")
        .replace("font-src 'self'", "font-src 'self' data:")
        .replace("base-uri 'none'", `base-uri ${assetBaseUrl}`);
    }
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll("\"", "&quot;")}">`;
    const head = /<head(?:\s[^>]*)?>/i.exec(authored);
    const injected = head ? `${authored.slice(0, head.index + head[0].length)}${meta}${base}${prelude}${importMap}${authored.slice(head.index + head[0].length)}` : `${meta}${base}${prelude}${importMap}${authored}`;
    body = nonceScripts(injected);
  }
  return new Response(body, { status: 200, headers: {
    "Content-Type": artifact.mediaType,
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=31536000, immutable"
  }});
}
