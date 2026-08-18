import type { StoredArtifact } from "./types.js";

export const NAPPLET_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export function artifactResponse(artifact: StoredArtifact, namespacePrelude = ""): Response {
  let body: BodyInit = artifact.bytes.slice().buffer;
  let csp = NAPPLET_CSP;
  if (artifact.mediaType.split(";", 1)[0]?.trim().toLowerCase() === "text/html") {
    const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    const html = new TextDecoder().decode(artifact.bytes);
    const prelude = namespacePrelude;
    const nonceScripts = (value: string): string => value.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
    csp = NAPPLET_CSP.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll("\"", "&quot;")}">`;
    const head = /<head(?:\s[^>]*)?>/i.exec(html);
    const injected = head ? `${html.slice(0, head.index + head[0].length)}${meta}${prelude}${html.slice(head.index + head[0].length)}` : `${meta}${prelude}${html}`;
    body = nonceScripts(injected);
  }
  return new Response(body, { status: 200, headers: {
    "Content-Type": artifact.mediaType,
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable"
  }});
}
