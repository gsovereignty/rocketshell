import { outbox, themeGet, themeOnChanged, type RelayEventResult } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import { firstMatchingState } from "./load";
import { selectNip66Relays } from "./relays";
import { aggregateMeritHoldings, firstTag, type NostrEvent } from "./state";

declare global { interface Window { napplet?: { theme?: { get?: unknown } } } }
const app = (() => {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Application root is missing.");
  return element;
})();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const number = new Intl.NumberFormat("en-US");
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-8)}`;
const escapeHtml = (value: string) => value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!);

function applyTheme(theme?: { colors: { background: string; text: string; primary: string } }): void {
  if (!theme) return;
  const valid = /^#[0-9a-f]{6}$/i;
  const { background, text, primary } = theme.colors;
  if (![background, text, primary].every((color) => valid.test(color))) {
    console.warn("Shell theme rejected because colors are not six-digit hex values", { background, text, primary });
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--background", background);
  root.style.setProperty("--text", text);
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--surface", `color-mix(in srgb, ${text} 5%, ${background})`);
  root.style.setProperty("--line", `color-mix(in srgb, ${text} 18%, ${background})`);
  root.style.setProperty("--muted", `color-mix(in srgb, ${text} 62%, ${background})`);
}

function renderState(event: NostrEvent, relays: string[]): void {
  const holdings = aggregateMeritHoldings(event);
  const total = holdings.reduce((sum, holding) => sum + holding.merits, 0n);
  const meritLots = holdings.reduce((sum, holding) => sum + holding.lots.length, 0);
  const bitcoin = firstTag(event, "bitcoin")?.split(":") ?? [];
  app.innerHTML = `<article class="state-view">
    <header class="masthead"><div><span class="eyebrow">Microsubjective Blockchain</span><h1>NOSTROCKET</h1><p>${escapeHtml(firstTag(event, "mission") ?? "Mission unavailable")}</p></div><button id="refresh" type="button">Refresh state</button></header>
    <section class="summary" aria-label="State summary"><div><span>Total merit</span><strong>${number.format(total)}</strong></div><div><span>Holders</span><strong>${holdings.length}</strong></div><div><span>Merit lots</span><strong>${meritLots}</strong></div></section>
    <section class="holdings" aria-labelledby="holdings-title"><header><div><span class="eyebrow">Ownership ledger</span><h2 id="holdings-title">Merit holdings</h2></div><span>${holdings.length} current holders</span></header>
      <ol>${holdings.map((holding, index) => { const percent = total ? Number(holding.merits * 10000n / total) / 100 : 0; return `<li class="holding"><details><summary><span class="rank">${String(index + 1).padStart(2, "0")}</span><span class="owner"><strong title="${holding.owner}">${short(holding.owner)}</strong><small>${holding.lots.length} lot${holding.lots.length === 1 ? "" : "s"}</small></span><span class="share"><strong>${number.format(holding.merits)}</strong><small>${percent.toFixed(2)}%</small></span><span class="bar" style="--share:${percent}%"><i></i></span></summary><div class="lots"><header><span>Approved request</span><span>Merit</span></header>${holding.lots.map((lot) => `<div><code title="${lot.requestId}">${short(lot.requestId)}</code><strong>${number.format(lot.merits)}</strong></div>`).join("")}</div></details></li>`; }).join("")}</ol>
    </section>
    <footer class="provenance"><div><span>State event</span><code title="${event.id}">${short(event.id)}</code></div><div><span>Published</span><time datetime="${new Date(event.created_at * 1000).toISOString()}">${new Date(event.created_at * 1000).toLocaleString()}</time></div><div><span>Ruleset</span><code>${escapeHtml(firstTag(event, "ruleset") ?? "unknown")}</code></div><div><span>Bitcoin height</span><code>${escapeHtml(bitcoin[0] ?? "unknown")}</code></div><div class="relay-line"><span>First response search</span><code>${escapeHtml(relays.length ? relays.join(" · ") : "author outbox routing")}</code></div></footer>
    <output id="status" aria-live="polite"></output>
  </article>`;
  document.querySelector<HTMLButtonElement>("#refresh")?.addEventListener("click", () => void load());
  if (!reducedMotion) gsap.fromTo(".summary > div, .holding, .provenance > div", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .035, ease: "power3.out" });
}

function showError(error: unknown): void {
  console.error("NOSTROCKET state load failed", { error });
  app.innerHTML = `<section class="error-state" role="alert"><span class="eyebrow">State unavailable</span><h1>Could not read NOSTROCKET.</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p><button id="retry" type="button">Try again</button></section>`;
  document.querySelector<HTMLButtonElement>("#retry")?.addEventListener("click", () => void load());
}

async function load(): Promise<void> {
  app.innerHTML = `<section class="boot-state" aria-live="polite"><div class="pulse"></div><p>Finding healthy relays, then reading first state…</p></section>`;
  try {
    const discovery = await outbox.query([{ kinds: [30166], limit: 500 }], { limit: 500, timeoutMs: 4500 });
    const relays = selectNip66Relays(discovery.events.map((result: RelayEventResult) => result.event as NostrEvent)).map(({ url }) => url);
    if (!relays.length) console.warn("No suitable NIP-66 observations found; using shell author-outbox routing");
    const event = await firstMatchingState(outbox.subscribe as Parameters<typeof firstMatchingState>[0], relays);
    renderState(event, relays);
  } catch (error) { showError(error); }
}

if (typeof window.napplet?.theme?.get === "function") {
  themeGet().then(applyTheme).catch((error: unknown) => console.warn("Initial shell theme could not be read", { error }));
  themeOnChanged(applyTheme);
}
void load();
