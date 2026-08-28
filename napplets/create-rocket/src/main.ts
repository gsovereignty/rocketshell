import { outbox, themeGet, themeOnChanged } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import { buildIgnitionTemplate, publishIgnition, validateDraft, type EventTemplate, type RocketDraft } from "./rocket";

declare global { interface Window { napplet?: { theme?: { get?: unknown } } } }
const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Application root is missing.");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pending: EventTemplate | undefined;

app.innerHTML = `<article class="sheet">
  <header class="masthead"><div><span class="eyebrow">Sovereign Economic Community</span><h1>Ignite a rocket</h1><p>Define its identity and mission. Shell signs and routes the ignition event.</p></div><span class="badge">31108</span></header>
  <section id="editor" aria-labelledby="details-title"><h2 id="details-title">Rocket details</h2>
    <label>Unique identifier <input id="identifier" autocomplete="off" placeholder="MY_ROCKET" aria-describedby="identifier-hint"></label><small id="identifier-hint">Required rocket name or identifier.</small>
    <label>Mission <textarea id="mission" maxlength="139" rows="4" placeholder="Why should this rocket exist? (optional)"></textarea></label><small><output id="mission-count">0</output>/139 characters</small>
    <details><summary>Problem and repository <span>recommended</span></summary><div class="optional-grid">
      <label>Problem coordinate <input id="problem-coordinate" placeholder="31971:pubkey:d-tag"></label><label>Problem relay <input id="problem-relay" placeholder="wss://relay.example"></label>
      <label>Repository coordinate <input id="repo-coordinate" placeholder="30617:pubkey:d-tag"></label><label>Repository relay <input id="repo-relay" placeholder="wss://relay.example"></label>
    </div></details>
    <div class="action"><output id="status" aria-live="polite">Draft stays local until preview and confirmation.</output><button id="preview" type="button">Review ignition <span>↗</span></button></div>
  </section>
  <section id="review" hidden aria-labelledby="review-title"><span class="eyebrow">Final check</span><h2 id="review-title">Publish this ignition?</h2><p>Publishing creates a public, signed kind 31108 event. NOSTROCKET is a structural reference only; no link to it is added.</p><pre id="event-preview"></pre><div class="review-actions"><button id="back" type="button">Back to edit</button><button id="publish" type="button">Publish rocket</button></div></section>
</article>`;

const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const mission = document.querySelector<HTMLTextAreaElement>("#mission")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const previewButton = document.querySelector<HTMLButtonElement>("#preview")!;
const publishButton = document.querySelector<HTMLButtonElement>("#publish")!;
const editor = document.querySelector<HTMLElement>("#editor")!;
const review = document.querySelector<HTMLElement>("#review")!;

function readDraft(): RocketDraft { return { identifier: input("identifier").value.trim(), mission: mission.value, problemCoordinate: input("problem-coordinate").value, problemRelay: input("problem-relay").value, repoCoordinate: input("repo-coordinate").value, repoRelay: input("repo-relay").value }; }
function setStatus(message: string, state = "idle"): void { status.textContent = message; status.dataset.state = state; }
function showEditor(): void { review.hidden = true; editor.hidden = false; pending = undefined; if (!reducedMotion) gsap.fromTo(editor, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: .28, ease: "power2.out" }); }

function showPreview(): void {
  const draft = readDraft();
  input("identifier").value = draft.identifier;
  const errors = validateDraft(draft);
  if (errors.length) { setStatus(errors.join(" "), "error"); return; }
  pending = buildIgnitionTemplate(draft, Math.floor(Date.now() / 1000));
  document.querySelector<HTMLElement>("#event-preview")!.textContent = JSON.stringify(pending, null, 2);
  editor.hidden = true; review.hidden = false;
  if (!reducedMotion) gsap.fromTo(review, { opacity: 0, x: 10 }, { opacity: 1, x: 0, duration: .32, ease: "power2.out" });
  publishButton.focus();
}

async function publish(): Promise<void> {
  if (!pending) { showEditor(); setStatus("Preview event again before publishing.", "error"); return; }
  publishButton.disabled = true; publishButton.textContent = "Publishing…";
  try {
    const id = await publishIgnition(outbox.publish as Parameters<typeof publishIgnition>[0], pending);
    review.innerHTML = `<span class="eyebrow">Ignition published</span><h2>Rocket launched.</h2><p>Signed event returned by shell:</p><code class="event-id">${id}</code>`;
    if (!reducedMotion) gsap.fromTo("#review > *", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .35, stagger: .06, ease: "power3.out" });
  } catch (error) {
    console.error("Rocket ignition publication failed", { identifier: input("identifier").value, error });
    publishButton.disabled = false; publishButton.textContent = "Publish rocket";
    const message = error instanceof Error ? error.message : "Rocket could not be published.";
    const errorLine = document.createElement("p"); errorLine.className = "review-error"; errorLine.setAttribute("role", "alert"); errorLine.textContent = message;
    review.querySelector(".review-error")?.remove(); review.querySelector(".review-actions")?.before(errorLine);
  }
}

mission.addEventListener("input", () => { document.querySelector<HTMLOutputElement>("#mission-count")!.value = String([...mission.value].length); });
previewButton.addEventListener("click", showPreview);
document.querySelector<HTMLButtonElement>("#back")!.addEventListener("click", showEditor);
publishButton.addEventListener("click", () => void publish());
editor.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); showPreview(); } });

function applyTheme(theme?: { colors: { background: string; text: string; primary: string } }): void {
  if (!theme) return;
  const valid = /^#[0-9a-f]{6}$/i;
  const { background, text, primary } = theme.colors;
  if (![background, text, primary].every((color) => valid.test(color))) { console.warn("Shell theme rejected because colors are not six-digit hex values", { background, text, primary }); return; }
  const root = document.documentElement;
  root.style.setProperty("--background", background); root.style.setProperty("--text", text); root.style.setProperty("--primary", primary);
  root.style.setProperty("--surface", `color-mix(in srgb, ${text} 4%, ${background})`); root.style.setProperty("--line", `color-mix(in srgb, ${text} 20%, ${background})`); root.style.setProperty("--muted", `color-mix(in srgb, ${text} 62%, ${background})`);
}
if (typeof window.napplet?.theme?.get === "function") { themeGet().then(applyTheme).catch((error: unknown) => console.warn("Initial shell theme could not be read", { error })); themeOnChanged(applyTheme); }
if (!reducedMotion) gsap.fromTo(".masthead, #editor", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .42, stagger: .08, ease: "power3.out" });
