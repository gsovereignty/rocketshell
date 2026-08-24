import { identity, inc, intent, outbox, themeGet, themeOnChanged, upload, type OutboxSubscription, type RelayEventResult, type Subscription, type Theme } from "@napplet/sdk";
import gsap from "gsap";
import "./styles.css";
import { EDIT_CONVENTION, STATUSES, buildRevisionTemplate, canEditProblem, hasProblemChildren, isEditPayload, problemGraphRoot, selectEditableProblem, type EditableProblem, type ProblemStatus } from "./problem";
import { revisionPublishMessage } from "./publish-result";
import { attachmentMarkdown, insertAtSelection } from "./attachment";

const appRoot = document.querySelector<HTMLElement>("#app");
if (!appRoot) throw new Error("App root is missing.");
const app: HTMLElement = appRoot;

let current: EditableProblem | undefined;
let identitySubscription: Subscription | undefined;
let intentSubscription: Subscription | undefined;
let themeSubscription: Subscription | undefined;
let problemSubscription: OutboxSubscription | undefined;
let problemEvents: RelayEventResult[] = [];
let loadGeneration = 0;
let pubkey = "";
let busy = false;
let uploading = false;
const uploadAvailable = Boolean((window as Window & { napplet?: { upload?: unknown } }).napplet?.upload);

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
    <div><h1 id="waiting-title">${escapeHtml(message)}</h1>
    <p>Launch this napplet through a compatible <code>${EDIT_CONVENTION}</code> intent.</p></div>
    <p id="status-message" class="status" role="status" aria-live="polite"></p>
  </section>`;
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.fromTo(".waiting > *", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .07, ease: "expo.out" });
  }
}

function stopProblemSubscription(): void {
  loadGeneration += 1;
  problemSubscription?.close();
  problemSubscription = undefined;
  problemEvents = [];
}

function editorIsDirty(problem: EditableProblem): boolean {
  const title = document.querySelector<HTMLInputElement>("#title");
  const description = document.querySelector<HTMLTextAreaElement>("#description");
  const problemStatus = document.querySelector<HTMLSelectElement>("#problem-status");
  const childStatus = document.querySelector<HTMLSelectElement>("#child-status");
  return Boolean(title && (title.value !== problem.title || description?.value !== problem.description ||
    problemStatus?.value !== problem.status || childStatus?.value !== (problem.childStatus ?? "")));
}

function receiveProblemRevision(problemId: string, result: RelayEventResult): void {
  if (problemEvents.some(({ event }) => event.id === result.event.id)) return;
  problemEvents.push(result);
  if (!current || current.problemId !== problemId) return;
  try {
    const previous = current;
    const next = selectEditableProblem(problemId, problemEvents, pubkey);
    if (next.event.id === previous.event.id && next.mayEdit === previous.mayEdit &&
      next.ancestorOwners.join() === previous.ancestorOwners.join()) return;
    const dirty = editorIsDirty(previous);
    current = next;
    if (!dirty) {
      renderEditor(next);
      status("Current head updated live.");
      return;
    }
    const publishButton = document.querySelector<HTMLButtonElement>("#publish");
    if (publishButton) publishButton.disabled = !next.mayEdit;
    status(next.mayEdit
      ? "Current head changed. Your draft will publish from latest revision."
      : "Current head changed and removed your edit permission.", !next.mayEdit);
  } catch (error) {
    console.warn("Live problem revision could not become editable head", { problemId, eventId: result.event.id, error });
    status(error instanceof Error ? error.message : "Live problem revision could not be applied.", true);
  }
}

function renderEditor(problem: EditableProblem): void {
  const disabled = !problem.mayEdit || busy;
  app.innerHTML = `<article class="editor-shell">
    <header class="masthead">
      <div><strong>Edit problem</strong><code title="${problem.problemId}">${shortKey(problem.problemId)}</code></div>
      <span class="authority ${problem.mayEdit ? "allowed" : "denied"}">${problem.mayEdit ? "Authorized editor" : "Read-only identity"}</span>
    </header>
    <div class="workspace">
      <section class="edit-panel" aria-labelledby="editor-title">
        <div class="section-title"><h1 id="editor-title">Next revision</h1><p>Update problem details, then publish complete snapshot.</p></div>
        <div class="field"><label for="title">Title</label><input id="title" maxlength="180" value="${escapeHtml(problem.title)}" ${disabled ? "disabled" : ""}></div>
        <div class="field grow"><label for="description">Description</label><textarea id="description" rows="10" ${disabled ? "disabled" : ""}>${escapeHtml(problem.description)}</textarea></div>
        <div class="attachment-field">
          <input id="attachment" type="file" accept="image/*,video/*" hidden ${disabled || !uploadAvailable ? "disabled" : ""}>
          <button id="attach-media" type="button" ${disabled || !uploadAvailable || uploading ? "disabled" : ""}>${uploading ? "Uploading…" : "Add image or video"}</button>
          <span id="attachment-status">${uploadAvailable ? "Uploads insert a Markdown reference into description." : "Media uploads are unavailable in this shell."}</span>
        </div>
        <div class="field-row">
          <div class="field"><label for="problem-status">Status</label><select id="problem-status" ${disabled ? "disabled" : ""}>${STATUSES.map((value) => `<option value="${value}"${value === problem.status ? " selected" : ""}>${value}</option>`).join("")}</select></div>
          <div class="field"><label for="child-status">New child default</label><select id="child-status" ${disabled ? "disabled" : ""}><option value="">Not set</option><option value="open"${problem.childStatus === "open" ? " selected" : ""}>open</option><option value="rfm"${problem.childStatus === "rfm" ? " selected" : ""}>rfm</option></select></div>
        </div>
        <footer><p id="status-message" class="status" role="status" aria-live="polite">${problem.mayEdit ? "Ready to publish." : "Connected identity is not the owner, a current maintainer, or an ancestor owner."}</p><button id="publish" type="button" ${disabled ? "disabled" : ""}>${busy ? "Publishing…" : "Publish revision"}</button></footer>
      </section>
    </div>
  </article>`;
  document.querySelector("#publish")?.addEventListener("click", () => void publishRevision());
  const attachmentInput = document.querySelector<HTMLInputElement>("#attachment");
  document.querySelector("#attach-media")?.addEventListener("click", () => attachmentInput?.click());
  attachmentInput?.addEventListener("change", () => void uploadAttachment(attachmentInput));
  document.querySelector(".edit-panel")?.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) {
      keyboardEvent.preventDefault();
      void publishRevision();
    }
  });
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.fromTo(".masthead, .edit-panel", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .065, ease: "expo.out" });
  }
}

async function uploadAttachment(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  const description = document.querySelector<HTMLTextAreaElement>("#description");
  const attachmentStatus = document.querySelector<HTMLElement>("#attachment-status");
  if (!file || !description || !attachmentStatus || uploading || !uploadAvailable) return;
  uploading = true;
  const button = document.querySelector<HTMLButtonElement>("#attach-media");
  const publishButton = document.querySelector<HTMLButtonElement>("#publish");
  if (button) { button.disabled = true; button.textContent = "Uploading…"; }
  if (publishButton) publishButton.disabled = true;
  attachmentStatus.textContent = `Uploading ${file.name}…`;
  try {
    const result = await upload.upload({ data: file, filename: file.name, mimeType: file.type || undefined });
    if (!result.ok || result.status !== "complete" || !result.url) throw new Error(result.error ?? "Media upload did not complete.");
    const caption = file.name.replace(/\.[^.]+$/, "") || "Attached media";
    insertAtSelection(description, attachmentMarkdown(result.url, caption));
    attachmentStatus.textContent = `${file.name} added to description.`;
    description.focus();
  } catch (error) {
    console.error("Problem revision media upload failed", { problemId: current?.problemId, filename: file.name, mimeType: file.type, size: file.size, error });
    attachmentStatus.textContent = error instanceof Error ? error.message : "Media upload failed. Try again.";
  } finally {
    uploading = false;
    input.value = "";
    if (button) { button.disabled = !current?.mayEdit; button.textContent = "Add image or video"; }
    if (publishButton) publishButton.disabled = !current?.mayEdit || busy;
  }
}

async function loadProblem(problemId: string): Promise<boolean> {
  stopProblemSubscription();
  const generation = loadGeneration;
  renderWaiting("Loading problem…");
  try {
    const buffered: RelayEventResult[] = [];
    let hydrated = false;
    const subscription = outbox.subscribe({ kinds: [31971], "#d": [problemId] }, { timeoutMs: 8000 });
    problemSubscription = subscription;
    subscription.on("event", (result) => {
      if (problemSubscription !== subscription) return;
      if (hydrated) receiveProblemRevision(problemId, result);
      else buffered.push(result);
    });
    subscription.on("closed", (reason) => {
      if (problemSubscription !== subscription) return;
      problemSubscription = undefined;
      console.warn("Live editable problem subscription closed", { problemId, reason });
      status("Live updates stopped. Reopen editor to reconnect.", true);
    });
    const response = await outbox.query({ kinds: [31971], "#d": [problemId], limit: 200 }, { limit: 200, timeoutMs: 8000 });
    if (generation !== loadGeneration) return false;
    const initialEvents = Array.from(new Map([...response.events, ...buffered].map((result) => [result.event.id, result])).values());
    const graphRoot = problemGraphRoot(problemId, initialEvents);
    const graphResponse = await outbox.query({ kinds: [31971], "#A": [graphRoot], limit: 1000 }, { limit: 1000, timeoutMs: 8000 });
    if (generation !== loadGeneration) return false;
    const graphSubscription = outbox.subscribe([
      { kinds: [31971], "#d": [problemId] },
      { kinds: [31971], "#A": [graphRoot] }
    ], { timeoutMs: 8000 });
    problemSubscription = graphSubscription;
    graphSubscription.on("event", (result) => {
      if (problemSubscription !== graphSubscription) return;
      if (hydrated) receiveProblemRevision(problemId, result);
      else buffered.push(result);
    });
    graphSubscription.on("closed", (reason) => {
      if (problemSubscription !== graphSubscription) return;
      problemSubscription = undefined;
      console.warn("Live problem DAG subscription closed", { problemId, graphRoot, reason });
      status("Live ancestry updates stopped. Reopen editor to reconnect.", true);
    });
    subscription.close();
    problemEvents = Array.from(new Map([...initialEvents, ...graphResponse.events, ...buffered].map((result) => [result.event.id, result])).values());
    current = selectEditableProblem(problemId, problemEvents, pubkey);
    hydrated = true;
    renderEditor(current);
    return true;
  } catch (error) {
    if (generation !== loadGeneration) return false;
    console.error("Problem revision load failed", { problemId, error });
    stopProblemSubscription();
    renderWaiting("Problem unavailable");
    status(error instanceof Error ? error.message : "Problem could not be loaded.", true);
    return false;
  }
}

async function publishRevision(): Promise<void> {
  if (!current || !current.mayEdit || busy || uploading) {
    if (uploading) status("Wait for media upload to finish before publishing.");
    return;
  }
  const publishingProblem = current;
  const title = document.querySelector<HTMLInputElement>("#title")?.value ?? "";
  const description = document.querySelector<HTMLTextAreaElement>("#description")?.value ?? "";
  const selectedStatus = document.querySelector<HTMLSelectElement>("#problem-status")?.value as ProblemStatus;
  const childValue = document.querySelector<HTMLSelectElement>("#child-status")?.value;
  let relayOutcomes: Readonly<Record<string, boolean>> | undefined;
  try {
    busy = true;
    const publishButton = document.querySelector<HTMLButtonElement>("#publish");
    if (publishButton) { publishButton.disabled = true; publishButton.textContent = "Publishing…"; }
    status("Checking child problems…");
    const coordinate = `31971:${publishingProblem.owner}:${publishingProblem.problemId}`;
    const childResponse = await outbox.query({ kinds: [31971], "#a": [coordinate], limit: 300 }, { limit: 300, timeoutMs: 8000 });
    const childProblemIds = [...new Set(childResponse.events.flatMap(({ event }) =>
      event.tags.some((item) => item[0] === "a" && item[3] === undefined && item[1] === coordinate)
        ? event.tags.filter((item) => item[0] === "d").map((item) => item[1]) : []))];
    const childRevisions = childProblemIds.length
      ? (await outbox.query({ kinds: [31971], "#d": childProblemIds, limit: 300 }, { limit: 300, timeoutMs: 8000 })).events
      : [];
    const hasChildren = hasProblemChildren(coordinate, [...childResponse.events, ...childRevisions]);
    status("Publishing complete revision…");
    const template = buildRevisionTemplate(publishingProblem, { title, description, status: selectedStatus, childStatus: childValue === "open" || childValue === "rfm" ? childValue : undefined }, Math.floor(Date.now() / 1000), hasChildren);
    const result = await outbox.publish(template, publishingProblem.relay ? { relays: [publishingProblem.relay] } : undefined);
    relayOutcomes = result.relays;
    const publishedMessage = revisionPublishMessage(result);
    status(`${publishedMessage} Loading confirmed head…`);
    if (!await loadProblem(publishingProblem.problemId)) return;
    const confirmedRevision = current;
    if (!confirmedRevision) throw new Error("Published revision could not be confirmed.");
    status(`${publishedMessage} Returning to problem…`);
    const returnResult = await intent.invoke({
      archetype: "note", action: "open", convention: "napplet:note/open",
      payload: { target: { type: "event", id: confirmedRevision.event.id } }, behavior: { focus: true, reuse: true }
    });
    if (!returnResult.ok || !returnResult.handled) throw new Error(returnResult.error ?? "No compatible problem viewer is available.");
  } catch (error) {
    console.error("Problem revision publish or return failed", { problemId: publishingProblem.problemId, previousRevisionId: publishingProblem.event.id, relayOutcomes, error });
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
      if (current) {
        current.isOwner = next === current.owner;
        current.mayEdit = canEditProblem(current, next);
        renderEditor(current);
      }
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

addEventListener("beforeunload", () => { problemSubscription?.close(); identitySubscription?.close(); intentSubscription?.close(); themeSubscription?.close(); });
void start();
