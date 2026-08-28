import { inc, outbox, themeGet, themeOnChanged, type Subscription } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import { buildMeritRequest, publishMeritRequest, validateDraft, type MeritRequestDraft, type MeritRequestTemplate, type SolutionType } from "./request";
import { MERIT_REQUEST_CONVENTION, parseMeritRequestPayload } from "./intent";

declare global { interface Window { napplet?: { theme?: { get?: unknown } } } }
const app = (() => {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Application root is missing.");
  return element;
})();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pending: MeritRequestTemplate | undefined;

app.innerHTML = `<main class="workspace">
  <header class="masthead"><div><span class="eyebrow">Sovereign Economic Community</span><h1>Request merits</h1><p>Make completed work legible. Shell signs request with your active Nostr identity.</p></div><span class="kind">kind 1409</span></header>
  <section id="editor" class="editor" aria-labelledby="request-title">
    <div class="fields"><h2 id="request-title">Work claim</h2>
      <label>Rocket coordinate<input id="rocket" autocomplete="off" spellcheck="false" placeholder="31108:rocket-pubkey:rocket-d-tag"></label>
      <label>Problem or work addressed<textarea id="problem" rows="5" placeholder="Describe what you solved and why it mattered."></textarea></label>
      <fieldset><legend>Solution evidence</legend><div class="type-switch" aria-label="Solution evidence type"><button type="button" data-solution-type="url" aria-pressed="true">URL</button><button type="button" data-solution-type="text" aria-pressed="false">Text</button></div><textarea id="solution" rows="3" placeholder="https://example.com/pull/123"></textarea><small>Optional proof. Choose URL or plain-text description.</small></fieldset>
      <div class="amounts"><label>Merits requested<input id="merits" inputmode="numeric" autocomplete="off" placeholder="33075"></label><label>Work value in sats <span>optional</span><input id="sats" inputmode="numeric" autocomplete="off" placeholder="33075"></label></div>
      <div class="action"><output id="status" aria-live="polite">Draft remains local until review.</output><button id="review-button" type="button">Review request</button></div>
    </div>
    <aside class="guide" aria-label="Request structure"><span class="eyebrow">Event structure</span><ol><li><b>01</b><span>State problem</span></li><li><b>02</b><span>Show evidence</span></li><li><b>03</b><span>Name Rocket</span></li><li><b>04</b><span>Value work</span></li></ol><p>Requester pubkey and signature come from shell, never this napplet.</p></aside>
  </section>
  <section id="review" class="review" hidden aria-labelledby="review-title"><span class="eyebrow">Final check</span><h2 id="review-title">Publish merit request?</h2><p>Public event will identify your active signer as requester.</p><pre id="preview"></pre><div id="review-error" role="alert"></div><div class="review-actions"><button id="back" type="button">Back to edit</button><button id="publish" type="button">Publish request</button></div></section>
</main>`;

const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const textarea = (id: string) => document.querySelector<HTMLTextAreaElement>(`#${id}`)!;
const editor = document.querySelector<HTMLElement>("#editor")!;
const review = document.querySelector<HTMLElement>("#review")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const publishButton = document.querySelector<HTMLButtonElement>("#publish")!;
let solutionType: SolutionType = "url";
let intentSubscription: Subscription | undefined;

function readDraft(): MeritRequestDraft {
  return { rocket: input("rocket").value, problem: textarea("problem").value, solution: textarea("solution").value, solutionType, merits: input("merits").value, sats: input("sats").value };
}
function showStatus(message: string, error = false): void { status.textContent = message; status.dataset.error = String(error); }
function showEditor(): void {
  review.hidden = true; editor.hidden = false; pending = undefined;
  if (!reducedMotion) gsap.fromTo(editor, { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: .3, ease: "power2.out" });
}
function showReview(): void {
  const draft = readDraft();
  const errors = validateDraft(draft);
  if (errors.length) { showStatus(errors.join(" "), true); return; }
  pending = buildMeritRequest(draft, Math.floor(Date.now() / 1000));
  document.querySelector<HTMLElement>("#preview")!.textContent = JSON.stringify(pending, null, 2);
  document.querySelector<HTMLElement>("#review-error")!.textContent = "";
  editor.hidden = true; review.hidden = false; publishButton.focus();
  if (!reducedMotion) gsap.fromTo(review, { x: 12, opacity: 0 }, { x: 0, opacity: 1, duration: .32, ease: "power2.out" });
}
async function publish(): Promise<void> {
  if (!pending) { showEditor(); showStatus("Review request again before publishing.", true); return; }
  publishButton.disabled = true; publishButton.textContent = "Publishing…";
  try {
    const result = await publishMeritRequest(outbox.publish as Parameters<typeof publishMeritRequest>[0], pending);
    review.innerHTML = `<span class="eyebrow">Request published</span><h2>Work claim submitted.</h2><p>Shell signed as <code>${result.pubkey ?? "active requester"}</code>.</p><code class="event-id">${result.id}</code>`;
    if (!reducedMotion) gsap.fromTo("#review > *", { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .35, stagger: .06, ease: "power3.out" });
  } catch (error) {
    console.error("Merit request publication failed", { rocket: readDraft().rocket, error });
    publishButton.disabled = false; publishButton.textContent = "Publish request";
    document.querySelector<HTMLElement>("#review-error")!.textContent = error instanceof Error ? error.message : "Merit request could not be published.";
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-solution-type]").forEach((button) => button.addEventListener("click", () => {
  solutionType = button.dataset.solutionType as SolutionType;
  document.querySelectorAll<HTMLButtonElement>("[data-solution-type]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  textarea("solution").placeholder = solutionType === "url" ? "https://example.com/pull/123" : "Describe shipped solution and evidence.";
}));
document.querySelector<HTMLButtonElement>("#review-button")!.addEventListener("click", showReview);
document.querySelector<HTMLButtonElement>("#back")!.addEventListener("click", showEditor);
publishButton.addEventListener("click", () => void publish());
editor.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); showReview(); } });

try {
  intentSubscription = inc.on(MERIT_REQUEST_CONVENTION, (event) => {
    const payload = parseMeritRequestPayload(event.payload);
    if (!payload) {
      console.warn("Merit request intent payload rejected", { convention: event.topic });
      showStatus("Problem tracker sent invalid merit request context.", true);
      return;
    }
    textarea("problem").value = payload.problem;
    showEditor();
    showStatus("Problem copied from tracker. Add Rocket and work value.");
    textarea("problem").focus();
  });
} catch (error) {
  console.warn("Merit request intent listener could not start", { convention: MERIT_REQUEST_CONVENTION, error });
  showStatus("Problem-tracker handoff unavailable. Manual request entry still works.");
}
window.addEventListener("pagehide", () => intentSubscription?.close(), { once: true });

function applyTheme(theme?: { colors: { background: string; text: string; primary: string } }): void {
  if (!theme) return;
  const valid = /^#[0-9a-f]{6}$/i;
  const { background, text, primary } = theme.colors;
  if (![background, text, primary].every((color) => valid.test(color))) { console.warn("Shell theme rejected because colors are not six-digit hex values", { background, text, primary }); return; }
  const root = document.documentElement;
  root.style.setProperty("--background", background); root.style.setProperty("--text", text); root.style.setProperty("--primary", primary);
  root.style.setProperty("--surface", `color-mix(in srgb, ${text} 4%, ${background})`); root.style.setProperty("--line", `color-mix(in srgb, ${text} 18%, ${background})`); root.style.setProperty("--muted", `color-mix(in srgb, ${text} 60%, ${background})`);
  root.style.backgroundColor = background; document.body.style.backgroundColor = background; document.body.style.color = text; app.style.backgroundColor = background;
}
if (typeof window.napplet?.theme?.get === "function") { themeGet().then(applyTheme).catch((error: unknown) => console.warn("Initial shell theme could not be read", { error })); themeOnChanged(applyTheme); }
if (!reducedMotion) gsap.fromTo(".masthead, .fields, .guide", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .42, stagger: .07, ease: "power3.out" });
