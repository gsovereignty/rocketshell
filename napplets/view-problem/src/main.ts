/*
  DIRECTION: Focused civic issue record. White reading surface, electric-blue
  action rail, compact semantic state, and discussion as continuous ledger.
  FORM: User-pinned problem-detail composition extended from sibling tracker UI.
  FINISH: Operate mode; responsive sandbox controls, visible state, restrained motion.
*/
import { identity, inc, intent, outbox, resource, type OutboxSubscription, type RelayEventResult, type Subscription } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import {
  COMMENT_KIND, buildWorkflowTemplate, coordinateFromProblemEvent, hasClaimRequest, parseCoordinate, relatedCoordinates, selectProblem, shortKey,
  type ProblemView
} from "./problem";
import { pubkeyAvatarHue, pubkeyAvatarLabel } from "./avatar";
import { profileFromEvents, type ProfileData } from "./profile";
import { formatRelativeTime } from "./time";

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
let intentSubscription: Subscription | undefined;
let busy = false;
let liveMessage = "";
let intentReceived = false;
const profiles = new Map<string, ProfileData>();
const avatarHandles = new Map<string, { url: string; revoke(): void }>();
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
const commentEvents = () => comments.filter(({ event }) => !event.tags.some((tag) => tag[0] === "patched"));

const authorName = (author: string) => profiles.get(author)?.name ?? shortKey(author);
const fallbackAvatar = (author: string) => `<span class="avatar" style="--avatar-hue:${pubkeyAvatarHue(author)}" aria-hidden="true">${escapeHtml(pubkeyAvatarLabel(authorName(author)))}</span>`;
const authorAvatar = (author: string) => {
  const profile = profiles.get(author);
  const handle = avatarHandles.get(author);
  if (profile?.picture && handle) return `<img class="avatar" src="${escapeHtml(handle.url)}" data-avatar-author="${author}" alt="">`;
  return fallbackAvatar(author);
};

function render() {
  if (!problem) return;
  const discussion = commentEvents().sort((a, b) => a.event.created_at - b.event.created_at);
  const claimPending = Boolean(pubkey) && hasClaimRequest(problem, comments, pubkey);
  const canClaim = problem.status === "open" && Boolean(pubkey) && !claimPending;
  app.innerHTML = `<article class="problem-view">
    <header class="topbar"><button id="change-problem" type="button">Change problem</button><code title="${problem.coordinate}">${shortKey(problem.problemId)}</code></header>
    <section class="problem-copy" aria-labelledby="problem-title">
      <div class="state-line"><span class="status status-${escapeHtml(problem.status)}"><i></i>${escapeHtml(statusLabel(problem.status))}</span></div>
      <h1 id="problem-title">${escapeHtml(problem.title)}</h1>
      <p class="description">${escapeHtml(problem.description)}</p>
      <div class="actions">
        <button class="primary" id="claim" type="button" ${canClaim && !busy ? "" : "disabled"}>${busy ? "Publishing…" : claimPending ? "Claim requested" : problem.status === "open" ? "Claim problem" : "Claim unavailable"}</button>
        <span>${problem.claim ? `Claimed by ${escapeHtml(shortKey(problem.claim.claimant))}${problem.claim.height ? ` at block ${escapeHtml(problem.claim.height)}` : ""}` : claimPending ? "Awaiting maintainer acceptance." : "Claim opens a 144-block response window after acceptance."}</span>
      </div>
      <button class="related-action" id="report-related" type="button">+ Log new problem under this one</button>
    </section>
    <section class="related" aria-labelledby="related-title">
      <h2 id="related-title">Related · ${related.length}</h2>
      ${related.length ? `<ul>${related.map((coordinate) => `<li><button type="button" data-related="${coordinate}"><span>Problem ${escapeHtml(shortKey(coordinate.split(":")[2]))}</span><code>${escapeHtml(shortKey(coordinate))}</code></button></li>`).join("")}</ul>` : `<p>No related problem mentions found yet.</p>`}
    </section>
    <section class="discussion" aria-labelledby="discussion-title">
      <h2 id="discussion-title">Discussion · ${discussion.length}</h2>
      <ol>${discussion.length ? discussion.map(({ event }) => `<li>
        ${authorAvatar(event.pubkey)}
        <div><header><strong title="${escapeHtml(event.pubkey)}">${escapeHtml(authorName(event.pubkey))}</strong><time datetime="${new Date(event.created_at * 1000).toISOString()}" title="${new Date(event.created_at * 1000).toLocaleString()}">${formatRelativeTime(event.created_at)}</time></header><p>${escapeHtml(event.content)}</p></div>
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
  document.querySelectorAll<HTMLImageElement>("[data-avatar-author]").forEach((image) => image.addEventListener("error", () => {
    const author = image.dataset.avatarAuthor;
    if (!author) return;
    avatarHandles.get(author)?.revoke();
    avatarHandles.delete(author);
    image.outerHTML = fallbackAvatar(author);
  }, { once: true }));
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
    const result = await outbox.publish(buildWorkflowTemplate(problem, content, action), { toInboxes: [problem.owner] });
    const acceptedRelays = Object.entries(result.relays ?? {}).filter(([, accepted]) => accepted).map(([relay]) => relay);
    if (!result.event || (!result.ok && acceptedRelays.length === 0)) {
      throw new Error(result.error ?? "Shell could not publish the event.");
    }
    receiveDiscussion({ event: result.event, sidecar: { relayHints: acceptedRelays } });
    setLiveStatus(action ? "Claim request published; awaiting maintainer acceptance." : "Comment published.");
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
  if (result.event.kind === COMMENT_KIND && !profiles.has(result.event.pubkey)) void loadProfiles([result.event.pubkey]);
}

async function loadProfiles(authors: string[]) {
  const missing = [...new Set(authors)].filter((author) => !profiles.has(author));
  if (!missing.length) return;
  missing.forEach((author) => profiles.set(author, { name: shortKey(author) }));
  try {
    const response = await outbox.query({ kinds: [0], authors: missing, limit: missing.length }, { limit: missing.length, timeoutMs: 8000 });
    for (const author of missing) {
      const profile = profileFromEvents(author, response.events.map(({ event }) => event));
      if (!profile) continue;
      profiles.set(author, profile);
      if (profile.picture) {
        try {
          const blob = await resource.bytes(profile.picture);
          const url = URL.createObjectURL(blob);
          avatarHandles.set(author, { url, revoke: () => URL.revokeObjectURL(url) });
        } catch (error) {
          console.warn("Profile picture fetch failed; using generated avatar", { author, picture: profile.picture, error });
        }
      }
    }
    if (problem) render();
  } catch (error) {
    console.warn("Profile metadata query failed; using pubkey fallbacks", { authors: missing, error });
  }
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
    void loadProfiles(comments.map(({ event }) => event.pubkey));
  } catch (error) { showSetup(error instanceof Error ? error.message : "Problem could not be loaded."); }
}

function isNoteOpenPayload(payload: unknown): payload is { target: { type: "event"; id: string } } {
  if (typeof payload !== "object" || payload === null) return false;
  const target = (payload as { target?: unknown }).target;
  return typeof target === "object" && target !== null &&
    (target as { type?: unknown }).type === "event" &&
    typeof (target as { id?: unknown }).id === "string" && /^[0-9a-f]{64}$/.test((target as { id: string }).id);
}

async function openProblemRevision(revisionId: string) {
  try {
    const response = await outbox.query({ ids: [revisionId], kinds: [31971], limit: 1 }, { limit: 1, timeoutMs: 8000 });
    const selected = response.events.find(({ event }) => event.id === revisionId)?.event;
    if (!selected) throw new Error("Selected problem revision was not found.");
    await loadProblem(coordinateFromProblemEvent(selected));
  } catch (error) {
    showSetup(error instanceof Error ? error.message : "Selected problem could not be opened.");
  }
}

async function start() {
  try {
    intentSubscription = inc.on("napplet:note/open", (event) => {
      intentReceived = true;
      if (!isNoteOpenPayload(event.payload)) {
        showSetup("Incoming problem-open request has an invalid event target.");
        return;
      }
      void openProblemRevision(event.payload.target.id);
    });
  } catch (error) {
    console.error("Problem-open intent subscription failed", { error });
    liveMessage = "Shell intent delivery unavailable. Paste a problem coordinate to continue.";
  }
  try {
    pubkey = await identity.getPublicKey();
    identitySubscription = identity.onChanged((next) => { pubkey = next; if (problem) render(); });
  } catch (error) {
    console.error("Shell identity initialization failed", { error });
    pubkey = "";
    liveMessage = "Shell identity unavailable. Viewing remains available; publishing is disabled.";
  }
  if (!intentReceived && !problem) showSetup();
}

addEventListener("beforeunload", () => {
  discussionSubscription?.close(); identitySubscription?.close(); intentSubscription?.close();
  avatarHandles.forEach((handle) => handle.revoke());
});
void start();
