import { identity, inc, outbox, themeGet, themeOnChanged, type Subscription, type Theme } from "@napplet/sdk";
import gsap from "gsap";
import "./styles.css";
import { EDIT_CONVENTION, STATUSES, buildRevisionTemplate, isEditPayload, selectEditableProblem, type EditableProblem, type ProblemStatus } from "./problem";
import { revisionPublishMessage } from "./publish-result";

const appRoot = document.querySelector<HTMLElement>("#app");
if (!appRoot) throw new Error("App root is missing.");
const app: HTMLElement = appRoot;

let current: EditableProblem | undefined;
let identitySubscription: Subscription | undefined;
let intentSubscription: Subscription | undefined;
let themeSubscription: Subscription | undefined;
let pubkey = "";
let busy = false;

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const shortKey = (value: string) => `${value.slice(0, 8)}…${value.slice(-5)}`;

function status(message: string, error = false): void {
  const node = document.querySelector<HTMLElement>("#status-message");
  if (!node) return;
  node.textContent = message;
  node.dataset.error = String(error);
}

function renderWaiting(message = "Waiting for problem…"): void {
  current = undefined;
  app.innerHTML = `<section class="waiting" aria-labelledby="waiting-title">
    <div class="mark" aria-hidden="true"><span></span><span></span><span></span></div>
    <div><p class="eyebrow">NIP-1971 · REVISION</p><h1 id="waiting-title">${escapeHtml(message)}</h1>
    <p>Launch this napplet through a compatible <code>${EDIT_CONVENTION}</code> intent.</p></div>
    <p id="status-message" class="status" role="status" aria-live="polite"></p>
  </section>`;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.fromTo(".waiting > *", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .07, ease: "expo.out" });
  }
}

function renderEditor(problem: EditableProblem): void {
  const disabled = !problem.mayEdit || busy;
  app.innerHTML = `<article class="editor-shell">
    <header class="masthead">
      <div><p class="eyebrow">EDIT PROBLEM</p><code title="${problem.problemId}">${shortKey(problem.problemId)}</code></div>
      <span class="authority ${problem.mayEdit ? "allowed" : "denied"}">${problem.mayEdit ? "Authorized editor" : "Read-only identity"}</span>
    </header>
    <div class="workspace">
      <aside>
        <p class="step">CURRENT HEAD</p>
        <h2>${escapeHtml(problem.title || "Untitled problem")}</h2>
        <dl><div><dt>Status</dt><dd>${escapeHtml(problem.status)}</dd></div><div><dt>Revision</dt><dd><code>${shortKey(problem.event.id)}</code></dd></div><div><dt>Owner</dt><dd><code>${shortKey(problem.owner)}</code></dd></div></dl>
        <p class="note">Publishing creates complete next snapshot and links current revision as previous.</p>
      </aside>
      <section class="edit-panel" aria-labelledby="editor-title">
        <div class="section-title"><p class="step">NEXT REVISION</p><h1 id="editor-title">Shape problem.</h1></div>
        <div class="field"><label for="title">Title</label><input id="title" maxlength="180" value="${escapeHtml(problem.title)}" ${disabled ? "disabled" : ""}></div>
        <div class="field grow"><label for="description">Description</label><textarea id="description" rows="10" ${disabled ? "disabled" : ""}>${escapeHtml(problem.description)}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="problem-status">Status</label><select id="problem-status" ${disabled ? "disabled" : ""}>${STATUSES.map((value) => `<option value="${value}"${value === problem.status ? " selected" : ""}>${value}</option>`).join("")}</select></div>
          <div class="field"><label for="child-status">New child default</label><select id="child-status" ${disabled ? "disabled" : ""}><option value="">Not set</option><option value="open"${problem.childStatus === "open" ? " selected" : ""}>open</option><option value="rfm"${problem.childStatus === "rfm" ? " selected" : ""}>rfm</option></select></div>
        </div>
        <footer><p id="status-message" class="status" role="status" aria-live="polite">${problem.mayEdit ? "Ready to publish." : "Connected identity is neither owner nor current maintainer."}</p><button id="publish" type="button" ${disabled ? "disabled" : ""}>${busy ? "Publishing…" : "Publish revision"}</button></footer>
      </section>
    </div>
  </article>`;
  document.querySelector("#publish")?.addEventListener("click", () => void publishRevision());
  document.querySelector(".edit-panel")?.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) {
      keyboardEvent.preventDefault();
      void publishRevision();
    }
  });
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.fromTo(".masthead, aside, .edit-panel", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .065, ease: "expo.out" });
  }
}

async function loadProblem(problemId: string): Promise<void> {
  renderWaiting("Loading problem…");
  try {
    const response = await outbox.query({ kinds: [31971], "#d": [problemId], limit: 200 }, { limit: 200, timeoutMs: 8000 });
    current = selectEditableProblem(problemId, response.events, pubkey);
    renderEditor(current);
  } catch (error) {
    console.error("Problem revision load failed", { problemId, error });
    renderWaiting("Problem unavailable");
    status(error instanceof Error ? error.message : "Problem could not be loaded.", true);
  }
}

async function publishRevision(): Promise<void> {
  if (!current || !current.mayEdit || busy) return;
  const title = document.querySelector<HTMLInputElement>("#title")?.value ?? "";
  const description = document.querySelector<HTMLTextAreaElement>("#description")?.value ?? "";
  const selectedStatus = document.querySelector<HTMLSelectElement>("#problem-status")?.value as ProblemStatus;
  const childValue = document.querySelector<HTMLSelectElement>("#child-status")?.value;
  let relayOutcomes: Readonly<Record<string, boolean>> | undefined;
  try {
    busy = true;
    const publishButton = document.querySelector<HTMLButtonElement>("#publish");
    if (publishButton) { publishButton.disabled = true; publishButton.textContent = "Publishing…"; }
    status("Publishing complete revision…");
    const template = buildRevisionTemplate(current, { title, description, status: selectedStatus, childStatus: childValue === "open" || childValue === "rfm" ? childValue : undefined }, Math.floor(Date.now() / 1000));
    const result = await outbox.publish(template, current.relay ? { relays: [current.relay] } : undefined);
    relayOutcomes = result.relays;
    const publishedMessage = revisionPublishMessage(result);
    status(`${publishedMessage} Loading confirmed head…`);
    await loadProblem(current.problemId);
  } catch (error) {
    console.error("Problem revision publish failed", { problemId: current.problemId, previousRevisionId: current.event.id, relayOutcomes, error });
    busy = false;
    const publishButton = document.querySelector<HTMLButtonElement>("#publish");
    if (publishButton) { publishButton.disabled = false; publishButton.textContent = "Publish revision"; }
    status(error instanceof Error ? error.message : "Revision could not be published.", true);
  } finally {
    busy = false;
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.colors.background);
  root.style.setProperty("--fg", theme.colors.text);
  root.style.setProperty("--accent", theme.colors.primary);
  root.style.backgroundColor = theme.colors.background;
  document.body.style.backgroundColor = theme.colors.background;
  document.body.style.color = theme.colors.text;
  app.style.backgroundColor = theme.colors.background;
}

async function start(): Promise<void> {
  renderWaiting();
  // Register before any await: shell delivers cold-start intents as soon as the
  // iframe reports ready, while identity initialization may still be pending.
  try {
    intentSubscription = inc.on(EDIT_CONVENTION, (event) => {
      if (!isEditPayload(event.payload)) {
        console.warn("Problem edit intent rejected invalid payload", { sender: event.sender });
        renderWaiting("Invalid edit request");
        status("Intent payload must contain one lowercase 64-character problemId.", true);
        return;
      }
      void loadProblem(event.payload.problemId);
    });
  } catch (error) {
    console.error("Problem edit intent subscription failed", { convention: EDIT_CONVENTION, error });
    status("Shell intent delivery unavailable.", true);
  }
  try {
    pubkey = await identity.getPublicKey();
    identitySubscription = identity.onChanged((next) => {
      pubkey = next;
      if (current) { current.mayEdit = next === current.owner || current.event.tags.some((item) => item[0] === "p" && item[1] === next && item[3] === "maintainer"); renderEditor(current); }
    });
  } catch (error) {
    console.error("Shell identity initialization failed", { error });
    status("Shell identity unavailable; editing disabled.", true);
  }
  const runtime = window as Window & { napplet?: { theme?: unknown } };
  if (runtime.napplet?.theme) {
    try {
      applyTheme(await themeGet());
      themeSubscription = themeOnChanged(applyTheme);
    } catch (error) {
      console.warn("Shell theme initialization failed; fallback palette retained", { error });
    }
  }
}

addEventListener("beforeunload", () => { identitySubscription?.close(); intentSubscription?.close(); themeSubscription?.close(); });
void start();
