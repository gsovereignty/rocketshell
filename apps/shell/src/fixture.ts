import { PackageInstaller, aggregateHash, sha256, type ArtifactInput, type PackageStore, type SignedManifest } from "@platform/napplet-gateway";
import { finalizeEvent } from "nostr-tools/pure";

const encoder = new TextEncoder();
const script = (resourceUrl: string): string => `
const status = document.querySelector("#fixture-status");
const results = { origin: window.origin, nostr: typeof window.nostr, storageBlocked: false, hostDomBlocked: false, fetchBlocked: false, websocketBlocked: false, resourceFetched: false, resourceObjectUrl: false, resourceRevoked: false, resourceError: "", pubkey: null, intentReceived: false, platformProfile: false, optionalAbsent: false };
try { localStorage.setItem("x", "x"); } catch { results.storageBlocked = true; }
try { void window.parent.document.body; } catch { results.hostDomBlocked = true; }
try { await fetch("https://example.com/"); } catch { results.fetchBlocked = true; }
try { const socket = new WebSocket("wss://example.com/"); await new Promise((resolve) => { socket.onerror = resolve; setTimeout(resolve, 500); }); if (socket.readyState !== WebSocket.OPEN) results.websocketBlocked = true; socket.close(); } catch { results.websocketBlocked = true; }
await window.napplet.shell.ready();
const required = ["identity", "outbox", "relay", "storage", "resource", "config", "theme", "intent", "inc", "link"];
results.platformProfile = required.every((domain) => window.napplet.shell.supports(domain) && typeof window.napplet[domain] === "object");
results.optionalAbsent = !window.napplet.shell.supports("notify") && window.napplet.notify === undefined;
results.pubkey = await window.napplet.identity.getPublicKey();
try {
  const resourceUrl = ${JSON.stringify(resourceUrl)};
  const blob = await window.napplet.resource.bytes(resourceUrl);
  results.resourceFetched = (await blob.text()).trim() === "verified fixture resource";
  const handle = window.napplet.resource.bytesAsObjectURL(resourceUrl);
  for (let attempt = 0; attempt < 100 && !handle.url; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
  results.resourceObjectUrl = handle.url.startsWith("blob:");
  let revokeCalls = 0;
  const revoke = handle.revoke;
  handle.revoke = () => { revokeCalls += 1; revoke(); };
  handle.revoke();
  results.resourceRevoked = revokeCalls === 1;
} catch (error) { results.resourceError = error instanceof Error ? error.message : String(error); }
const intentReceived = new Promise((resolve) => {
  const handle = window.napplet.inc.on("napplet:fixture/open", (event) => { results.intentReceived = event.payload?.ok === true; handle.close(); resolve(); });
});
await window.napplet.intent.open("fixture", { ok: true });
await intentReceived;
Object.assign(document.documentElement.dataset, Object.fromEntries(Object.entries(results).map(([key, value]) => [key, String(value)])));
status.textContent = "ready";
`;

export async function installFixture(store: PackageStore, resourceUrl: string): Promise<string> {
  if (await store.getActive("platform-fixture")) return "platform-fixture";
  const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Fixture Napplet</title></head><body><output id="fixture-status">starting</output><script type="module">${script(resourceUrl)}</script></body></html>`;
  const entries = [{ path: "index.html", bytes: encoder.encode(html), mediaType: "text/html" }];
  const declarations = await Promise.all(entries.map(async ({ path, bytes, mediaType }) => ({ path, sha256: await sha256(bytes), mediaType })));
  const aggregate = await aggregateHash(declarations);
  const requires = ["identity", "outbox", "relay", "storage", "resource", "config", "theme", "intent", "inc", "link"];
  const content = JSON.stringify({ dTag: "platform-fixture", title: "Platform Fixture", aggregateHash: aggregate, entrypoint: "index.html", requires, archetypes: [{ slug: "fixture", convention: "napplet:fixture/open" }], artifacts: declarations });
  const secret = new Uint8Array(32); secret[31] = 1;
  const tags = [["d", "platform-fixture"], ...requires.map((domain) => ["requires", domain]), ...declarations.map((artifact) => ["path", `/${artifact.path}`, artifact.sha256])];
  const event = finalizeEvent({ kind: 35129, created_at: 1, content, tags }, secret) as SignedManifest;
  const inputs = new Map<string, ArtifactInput>(entries.map(({ path, bytes, mediaType }) => [path, { bytes, mediaType }]));
  await new PackageInstaller(store).install(event, inputs, { randomId: () => "built-in-platform-fixture" });
  return "platform-fixture";
}
