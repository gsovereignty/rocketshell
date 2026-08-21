/*
  DIRECTION: Focused civic issue record. White reading surface, electric-blue
  action rail, compact semantic state, and discussion as continuous ledger.
  FORM: User-pinned problem-detail composition extended from sibling tracker UI.
  FINISH: Operate mode; responsive sandbox controls, visible state, restrained motion.
*/
import { identity, intent, outbox, type OutboxSubscription, type RelayEventResult } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import {
  COMMENT_KIND, buildWorkflowTemplate, parseCoordinate, relatedCoordinates, selectProblem, shortKey,
  type ProblemView
} from "./problem";

const app = (() => {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Application root is missing.");
  return element;
})();

let problem: ProblemView | undefined;
let comments: RelayEventResult[] = [];
let relatedEvents: RelayEventResult[] = [];
let related: string[] = [];
let pubkey = "";
let discussionSubscription: OutboxSubscription | undefined;
let identitySubscription: { close(): void } | undefined;
let busy = false;
let liveMessage = "";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const escapeHtml = (value: string) => value.replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
})[character]!);

function showSetup(message = "") {
  discussionSubscription?.close();
  app.innerHTML = `<section class="setup" aria-labelledby="setup-title">
    <div class="setup-glyph" aria-hidden="true"><span></span><span></span><span></span></div>
    <div><h1 id="setup-title">Open a problem</h1><p>Paste its full NIP-1971 coordinate to load current state and discussion.</p></div>
    <div class="coordinate-entry" id="coordinate-entry">
      <label for="coordinate">Problem coordinate</label>
      <div><input id="coordinate" autocomplete="off" spellcheck="false" placeholder="31971:owner:problem-id" aria-describedby="setup-status"${message ? ' aria-invalid="true"' : ""}><button type="button">View problem</button></div>
      <output id="setup-status" aria-live="polite">${escapeHtml(message)}</output>
    </div>
  </section>`;
  const input = document.querySelector<HTMLInputElement>("#coordinate");
  const open = () => { if (input) void loadProblem(input.value); };
  document.querySelector("#coordinate-entry button")?.addEventListener("click", open);
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    open();
  });
  if (!reducedMotion) gsap.fromTo(".setup > *", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .07, ease: "expo.out" });
}

const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);
const commentEvents = () => comments.filter(({ event }) => !event.tags.some((tag) => tag[0] === "claim" || tag[0] === "patched"));

function render() {
  if (!problem) return;
  const discussion = commentEvents().sort((a, b) => a.event.created_at - b.event.created_at);
  const canClaim = problem.status === "open" && Boolean(pubkey);
  app.innerHTML = `<article class="problem-view">
    <header class="topbar"><button id="change-problem" type="button">Change problem</button><code title="${problem.coordinate}">${shortKey(problem.problemId)}</code></header>
    <section class="problem-copy" aria-labelledby="problem-title">
      <div class="state-line"><span class="status status-${escapeHtml(problem.status)}"><i></i>${escapeHtml(statusLabel(problem.status))}</span></div>
      <h1 id="problem-title">${escapeHtml(problem.title)}</h1>
      <p class="description">${escapeHtml(problem.description)}</p>
      <div class="actions">
        <button class="primary" id="claim" type="button" ${canClaim && !busy ? "" : "disabled"}>${busy ? "Publishing…" : problem.status === "open" ? "Claim problem" : "Claim unavailable"}</button>
        <span>${problem.claim ? `Claimed by ${escapeHtml(shortKey(problem.claim.claimant))}${problem.claim.height ? ` at block ${escapeHtml(problem.claim.height)}` : ""}` : "Claim opens a 144-block response window after acceptance."}</span>
      </div>
      <button class="related-action" id="report-related" type="button">+ Report a related problem</button>
    </section>
    <section class="related" aria-labelledby="related-title">
      <h2 id="related-title">Related · ${related.length}</h2>
      ${related.length ? `<ul>${related.map((coordinate) => `<li><button type="button" data-related="${coordinate}"><span>Problem ${escapeHtml(shortKey(coordinate.split(":")[2]))}</span><code>${escapeHtml(shortKey(coordinate))}</code></button></li>`).join("")}</ul>` : `<p>No related problem mentions found yet.</p>`}
    </section>
    <section class="discussion" aria-labelledby="discussion-title">
      <h2 id="discussion-title">Discussion · ${discussion.length}</h2>
      <ol>${discussion.length ? discussion.map(({ event }) => `<li>
        <span class="avatar" aria-hidden="true">${event.pubkey.slice(0, 2).toUpperCase()}</span>
        <div><header><strong>${escapeHtml(shortKey(event.pubkey))}</strong><time datetime="${new Date(event.created_at * 1000).toISOString()}">${new Date(event.created_at * 1000).toLocaleDateString()}</time></header><p>${escapeHtml(event.content)}</p></div>
      </li>`).join("") : `<li class="empty">No comments yet. Start discussion.</li>`}</ol>
      <div class="comment-entry" id="comment-entry">
        <label class="sr-only" for="comment">Leave a comment</label>
        <textarea id="comment" rows="1" maxlength="4000" placeholder="Leave a comment…" ${pubkey && !busy ? "" : "disabled"}></textarea>
        <button id="post-comment" type="button" ${pubkey && !busy ? "" : "disabled"}>Post</button>
      </div>
    </section>
    <output id="app-status" aria-live="polite">${escapeHtml(liveMessage || (pubkey ? "" : "Sign in through shell to claim or comment."))}</output>
  </article>`;
  bind();
  if (!reducedMotion) gsap.fromTo(".problem-copy > *, .related, .discussion", { y: 9, opacity: 0 }, { y: 0, opacity: 1, duration: .38, stagger: .045, ease: "expo.out" });
}

function bind() {
  document.querySelector("#change-problem")?.addEventListener("click", () => showSetup());
  document.querySelector("#claim")?.addEventListener("click", () => void publishAction("I am claiming this problem.", "claim"));
  document.querySelector("#report-related")?.addEventListener("click", () => void reportRelated());
  document.querySelector("#post-comment")?.addEventListener("click", () => void postComment());
  document.querySelector("#comment")?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void postComment();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-related]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.related) void loadProblem(button.dataset.related);
  }));
}

async function publishAction(content: string, action?: "claim") {
  if (!problem || !pubkey || busy) return;
  busy = true;
  render();
  try {
    await outbox.publish(buildWorkflowTemplate(problem, content, action), { toInboxes: [problem.owner] });
    setLiveStatus(action ? "Claim request published." : "Comment published.");
  } catch (error) {
    setLiveStatus(error instanceof Error ? error.message : "Event could not be published.");
  } finally {
    busy = false;
    render();
  }
}

async function postComment() {
  const input = document.querySelector<HTMLTextAreaElement>("#comment");
  const content = input?.value.trim() ?? "";
  if (!content) { setLiveStatus("Write a comment before posting."); input?.focus(); return; }
  await publishAction(content);
}

async function reportRelated() {
  if (!problem) return;
  setLiveStatus("Opening related problem composer…");
  try {
    const result = await intent.invoke({ archetype: "composer", action: "problem-child", convention: "napplet:composer/problem-child", payload: { problemId: problem.problemId }, behavior: { focus: true, reuse: true } });
    if (!result.ok || !result.handled) throw new Error(result.error ?? "No compatible problem composer is available.");
    setLiveStatus("Related problem composer opened.");
  } catch (error) { setLiveStatus(error instanceof Error ? error.message : "Problem composer could not be opened."); }
}

function setLiveStatus(message: string) {
  liveMessage = message;
  const output = document.querySelector<HTMLOutputElement>("#app-status");
  if (output) output.textContent = message;
}

function receiveDiscussion(result: RelayEventResult) {
  const collection = result.event.kind === COMMENT_KIND ? comments : relatedEvents;
  if (collection.some(({ event }) => event.id === result.event.id)) return;
  collection.push(result);
  if (problem) related = relatedCoordinates(problem, [...comments, ...relatedEvents]);
  render();
}

async function loadProblem(value: string) {
  const status = document.querySelector<HTMLOutputElement>("#setup-status");
  try {
    const target = parseCoordinate(value);
    if (status) status.textContent = "Loading current revision and discussion…";
    discussionSubscription?.close();
    const problemResponse = await outbox.query({ kinds: [31971], "#d": [target.problemId], limit: 200 }, { limit: 200, timeoutMs: 8000 });
    problem = selectProblem(target.coordinate, problemResponse.events);
    const filters = [{ kinds: [COMMENT_KIND], "#A": [target.coordinate] }, { kinds: [31971], "#a": [target.coordinate] }];
    const response = await outbox.query(filters, { limit: 300, timeoutMs: 8000 });
    comments = response.events.filter(({ event }) => event.kind === COMMENT_KIND);
    relatedEvents = [...problemResponse.events, ...response.events.filter(({ event }) => event.kind === 31971)];
    related = relatedCoordinates(problem, [...comments, ...relatedEvents]);
    discussionSubscription = outbox.subscribe(filters, { timeoutMs: 8000 });
    discussionSubscription.on("event", receiveDiscussion);
    render();
  } catch (error) { showSetup(error instanceof Error ? error.message : "Problem could not be loaded."); }
}

async function start() {
  try {
    pubkey = await identity.getPublicKey();
    identitySubscription = identity.onChanged((next) => { pubkey = next; if (problem) render(); });
  } catch {
    pubkey = "";
    liveMessage = "Shell identity unavailable. Viewing remains available; publishing is disabled.";
  }
  showSetup();
}

addEventListener("beforeunload", () => { discussionSubscription?.close(); identitySubscription?.close(); });
void start();
