import { inc, outbox, resource, themeGet, themeOnChanged, type NostrEvent, type Subscription } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import "./selector.css";
import { buildMeritRequest, publishMeritRequest, validateDraft, type MeritRequestDraft, type MeritRequestTemplate, type SolutionType } from "./request";
import { MERIT_REQUEST_CONVENTION, parseMeritRequestPayload } from "./intent";
import { NOSTROCKET_COORDINATE, avatarLabel, profilesFromEvents, rocketsFromEvents, type RocketOption, type RocketProfile } from "./rockets";

declare global { interface Window { napplet?: { theme?: { get?: unknown }; resource?: unknown } } }
const app = (() => {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Application root is missing.");
  return element;
})();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pending: MeritRequestTemplate | undefined;
let rockets: RocketOption[] = rocketsFromEvents([]);
let selectedRocket = NOSTROCKET_COORDINATE;
let rocketProfiles = new Map<string, RocketProfile>();
const avatarUrls = new Map<string, string>();

app.innerHTML = `<main class="workspace">
  <header class="masthead"><div><span class="eyebrow">Sovereign Economic Community</span><h1>Request merits</h1><p>Make completed work legible. Shell signs request with your active Nostr identity.</p></div><span class="kind">kind 1409</span></header>
  <section id="editor" class="editor" aria-labelledby="request-title">
    <div class="fields"><h2 id="request-title">Work claim</h2>
      <div class="rocket-field"><span class="field-label">Rocket</span><input id="rocket" type="hidden" value="${NOSTROCKET_COORDINATE}"><button id="rocket-trigger" class="rocket-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="rocket-list"></button><div id="rocket-menu" class="rocket-menu" hidden><div id="rocket-list" role="listbox" aria-label="Rocket coordinate"></div><output id="rocket-status" aria-live="polite">Loading available Rockets…</output></div></div>
      <label>Problem or work addressed<textarea id="problem" rows="5" placeholder="Describe what you solved and why it mattered."></textarea></label>
      <fieldset><legend>Solution evidence</legend><div class="type-switch" aria-label="Solution evidence type"><button type="button" data-solution-type="url" aria-pressed="true">URL</button><button type="button" data-solution-type="text" aria-pressed="false">Text</button></div><textarea id="solution" rows="3" placeholder="https://example.com/pull/123"></textarea><small>Optional proof. Choose URL or plain-text description.</small></fieldset>
      <div class="amounts"><label>Work value in sats<input id="sats" inputmode="numeric" autocomplete="off" placeholder="33075" aria-describedby="sats-help" required><small id="sats-help">Merits requested are set 1:1 from this value.</small></label></div>
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
const rocketTrigger = document.querySelector<HTMLButtonElement>("#rocket-trigger")!;
const rocketMenu = document.querySelector<HTMLElement>("#rocket-menu")!;
const rocketList = document.querySelector<HTMLElement>("#rocket-list")!;
const rocketStatus = document.querySelector<HTMLOutputElement>("#rocket-status")!;
let solutionType: SolutionType = "url";
let intentSubscription: Subscription | undefined;

function readDraft(): MeritRequestDraft {
  return { rocket: input("rocket").value, problem: textarea("problem").value, solution: textarea("solution").value, solutionType, sats: input("sats").value };
}

function rocketAvatar(rocket: RocketOption): HTMLElement {
  const avatar = document.createElement("span");
  avatar.className = "rocket-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const url = avatarUrls.get(rocket.author);
  if (url) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    avatar.append(image);
  } else {
    avatar.textContent = avatarLabel(rocket.name);
    avatar.style.setProperty("--avatar-hue", String(parseInt(rocket.author.slice(0, 6), 16) % 360));
  }
  return avatar;
}

function rocketCopy(rocket: RocketOption): HTMLElement {
  const copy = document.createElement("span");
  copy.className = "rocket-copy";
  const name = document.createElement("strong");
  name.textContent = rocket.name;
  const coordinate = document.createElement("small");
  coordinate.textContent = rocket.coordinate;
  copy.append(name, coordinate);
  return copy;
}

function renderRocketSelector(): void {
  const selected = rockets.find(({ coordinate }) => coordinate === selectedRocket) ?? rockets[0];
  selectedRocket = selected.coordinate;
  input("rocket").value = selected.coordinate;
  rocketTrigger.replaceChildren(rocketAvatar(selected), rocketCopy(selected));
  const chevron = document.createElement("span");
  chevron.className = "rocket-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "v";
  rocketTrigger.append(chevron);
  rocketList.replaceChildren();
  rockets.forEach((rocket) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "rocket-option";
    option.dataset.coordinate = rocket.coordinate;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(rocket.coordinate === selectedRocket));
    option.append(rocketAvatar(rocket), rocketCopy(rocket));
    option.addEventListener("click", () => selectRocket(rocket.coordinate));
    rocketList.append(option);
  });
}

function closeRocketMenu(restoreFocus = false): void {
  if (rocketMenu.hidden) return;
  rocketTrigger.setAttribute("aria-expanded", "false");
  if (!reducedMotion) {
    gsap.to(rocketMenu, { y: -5, opacity: 0, duration: .14, ease: "power2.in", onComplete: () => { rocketMenu.hidden = true; gsap.set(rocketMenu, { clearProps: "all" }); } });
  } else rocketMenu.hidden = true;
  if (restoreFocus) rocketTrigger.focus();
}

function openRocketMenu(): void {
  if (!rocketMenu.hidden) { closeRocketMenu(); return; }
  rocketMenu.hidden = false;
  rocketTrigger.setAttribute("aria-expanded", "true");
  if (!reducedMotion) gsap.fromTo(rocketMenu, { y: -5, opacity: 0 }, { y: 0, opacity: 1, duration: .18, ease: "power2.out" });
  rocketList.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
}

function selectRocket(coordinate: string): void {
  selectedRocket = coordinate;
  renderRocketSelector();
  closeRocketMenu(true);
  showStatus("Rocket selected. Draft remains local until review.");
}

async function loadRocketAvatars(authors: string[]): Promise<void> {
  if (!window.napplet?.resource) {
    console.warn("Rocket profile images unavailable; shell resource domain is missing", { authors: authors.length });
    return;
  }
  const queue = [...new Set(authors)].filter((author) => rocketProfiles.get(author)?.picture && !avatarUrls.has(author));
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const author = queue.shift();
      if (!author) continue;
      const picture = rocketProfiles.get(author)?.picture;
      if (!picture) continue;
      try {
        const blob = await resource.bytes(picture);
        if (!blob.type.startsWith("image/")) {
          console.warn("Rocket profile image rejected; resource is not an image", { author, picture, mimeType: blob.type });
          continue;
        }
        avatarUrls.set(author, URL.createObjectURL(blob));
      } catch (error) {
        console.warn("Rocket profile image fetch failed; using generated avatar", { author, picture, error });
      }
    }
  }));
  renderRocketSelector();
}

async function loadRockets(): Promise<void> {
  rocketStatus.textContent = "Loading available Rockets…";
  try {
    const response = await outbox.query({ kinds: [31108], limit: 500 }, { limit: 500, timeoutMs: 8000 });
    rockets = rocketsFromEvents(response.events.map(({ event }) => event));
    renderRocketSelector();
    rocketStatus.textContent = `${rockets.length} Rocket${rockets.length === 1 ? "" : "s"} available.`;
    const authors = [...new Set(rockets.map(({ author }) => author))];
    try {
      const profiles = await outbox.query({ kinds: [0], authors, limit: authors.length }, { limit: authors.length, timeoutMs: 8000 });
      rocketProfiles = profilesFromEvents(profiles.events.map(({ event }) => event as NostrEvent));
      renderRocketSelector();
      await loadRocketAvatars(authors);
    } catch (error) {
      console.warn("Rocket author profile query failed; using generated avatars", { authors: authors.length, error });
      rocketStatus.textContent = `${rockets.length} Rocket${rockets.length === 1 ? "" : "s"} available. Profile images unavailable.`;
    }
  } catch (error) {
    console.error("Rocket event query failed; keeping confirmed NOSTROCKET default", { defaultCoordinate: NOSTROCKET_COORDINATE, error });
    rocketStatus.textContent = "Other Rockets unavailable. NOSTROCKET remains selected.";
  }
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
rocketTrigger.addEventListener("click", openRocketMenu);
rocketMenu.addEventListener("keydown", (event) => {
  const options = [...rocketList.querySelectorAll<HTMLButtonElement>(".rocket-option")];
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape") { event.preventDefault(); closeRocketMenu(true); }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    options[(index + step + options.length) % options.length]?.focus();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!rocketMenu.hidden && event.target instanceof Node && !rocketMenu.contains(event.target) && !rocketTrigger.contains(event.target)) closeRocketMenu();
});

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
window.addEventListener("pagehide", () => {
  intentSubscription?.close();
  avatarUrls.forEach((url) => URL.revokeObjectURL(url));
  avatarUrls.clear();
}, { once: true });

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
renderRocketSelector();
void loadRockets();
if (!reducedMotion) gsap.fromTo(".masthead, .fields, .guide", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .42, stagger: .07, ease: "power3.out" });
