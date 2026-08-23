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
  COMMENT_KIND, buildWorkflowTemplate, compareProblemRevisions, coordinateFromProblemEvent, formatClaimCountdown, hasClaimRequest, hasProblemChildren, parseCoordinate, relatedCoordinates,
  mayEditProblem, problemEdits, problemRevisionAuthors, problemRevisionHistory, selectEffectiveClaim, selectProblem, shortKey,
  type ProblemView
} from "./problem";
import { pubkeyAvatarHue, pubkeyAvatarLabel } from "./avatar";
import { profileFromEvents, type ProfileData } from "./profile";
import { formatRelativeTime } from "./time";
import { renderMarkdown } from "./markdown";

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
let loadGeneration = 0;
let identitySubscription: { close(): void } | undefined;
let intentSubscription: Subscription | undefined;
let busy = false;
let liveMessage = "";
let intentReceived = false;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
const profiles = new Map<string, ProfileData>();
const avatarHandles = new Map<string, { url: string; revoke(): void }>();
const avatarRequestVersions = new Map<string, number>();
const mediaObjectUrls = new Set<string>();
let mediaRenderVersion = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const escapeHtml = (value: string) => value.replace(/[&<>\"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
})[character]!);

function showSetup(message = "") {
  resetMedia();
  stopDiscussionSubscription();
  if (countdownTimer) clearInterval(countdownTimer);
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

function showLoadingProblem() {
  resetMedia();
  stopDiscussionSubscription();
  if (countdownTimer) clearInterval(countdownTimer);
  app.innerHTML = `<section class="setup loading-state" aria-labelledby="loading-title" aria-live="polite">
    <div class="setup-glyph" aria-hidden="true"><span></span><span></span><span></span></div>
    <div><h1 id="loading-title">Loading problem</h1><p>Finding the selected revision and its current discussion…</p></div>
  </section>`;
  if (!reducedMotion) gsap.fromTo(".loading-state > *", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .07, ease: "expo.out" });
}

function stopDiscussionSubscription() {
  loadGeneration += 1;
  discussionSubscription?.close();
  discussionSubscription = undefined;
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

const revisionChanges = (revision: ReturnType<typeof problemRevisionHistory>[number], revisions: ReturnType<typeof problemRevisionHistory>) => {
  if (!revision.previousIds.length) return `<p class="history-note">Initial version</p>${renderChanges(compareProblemRevisions(undefined, revision))}`;
  const parents = revision.previousIds.map((id) => revisions.find((candidate) => candidate.id === id)).filter((parent) => parent !== undefined);
  if (!parents.length) return `<p class="history-note">Previous version unavailable from connected relays.</p>`;
  return parents.map((parent) => `${revision.previousIds.length > 1 ? `<p class="history-note">Compared with ${shortKey(parent.id)}</p>` : ""}${renderChanges(compareProblemRevisions(parent, revision))}`).join("");
};

const renderChanges = (changes: ReturnType<typeof compareProblemRevisions>) => changes.length
  ? `<dl class="revision-changes">${changes.map(({ field, before, after }) => `<div><dt>${field}</dt><dd>${before === undefined ? `<ins>${escapeHtml(after || "None")}</ins>` : `<del>${escapeHtml(before || "None")}</del><ins>${escapeHtml(after || "None")}</ins>`}</dd></div>`).join("")}</dl>`
  : `<p class="history-note">No visible field changes.</p>`;

function render() {
  if (!problem) return;
  resetMedia();
  const discussion = commentEvents().sort((a, b) => a.event.created_at - b.event.created_at);
  const revisions = problemRevisionHistory(problem.coordinate, relatedEvents);
  const edits = problemEdits(revisions);
  const activity = [
    ...edits.map((revision) => ({ type: "revision" as const, createdAt: revision.createdAt, revision })),
    ...discussion.map((result) => ({ type: "comment" as const, createdAt: result.event.created_at, result }))
  ].sort((a, b) => a.createdAt - b.createdAt);
  const effectiveClaim = selectEffectiveClaim(problem, comments, revisions);
  const hasChildren = hasProblemChildren(problem.coordinate, relatedEvents);
  const claimPending = problem.status === "rfm" && Boolean(pubkey) && hasClaimRequest(problem, comments, pubkey);
  const displayedStatus = effectiveClaim ? "claimed" : problem.status;
  const canClaim = problem.status === "open" && !hasChildren && Boolean(pubkey) && !effectiveClaim && !claimPending;
  const canEdit = mayEditProblem(problem, pubkey);
  const claimDetails = effectiveClaim ? `<div class="claim-summary">
    ${authorAvatar(effectiveClaim.claimant)}
    <div><span>Claimed by</span><strong title="${escapeHtml(effectiveClaim.claimant)}">${escapeHtml(authorName(effectiveClaim.claimant))}</strong></div>
    <div class="claim-deadline"><span>Time left for PR</span>${effectiveClaim.expiresAt
      ? `<time data-claim-deadline="${effectiveClaim.expiresAt}" datetime="${new Date(effectiveClaim.expiresAt * 1000).toISOString()}">${formatClaimCountdown(effectiveClaim.expiresAt - Date.now() / 1000)}</time>`
      : `<strong>Deadline unavailable</strong>`}</div>
  </div>` : "";
  app.innerHTML = `<article class="problem-view">
    <header class="topbar"><button id="change-problem" type="button">Change problem</button><div class="topbar-actions"><button id="edit-problem" type="button" ${canEdit ? "" : "disabled"} title="${canEdit ? "Edit this problem" : "Only the author, a current maintainer, or a direct parent author can edit this problem"}">Edit problem</button><code title="${problem.coordinate}">${shortKey(problem.problemId)}</code></div></header>
    <section class="problem-copy" aria-labelledby="problem-title">
      <div class="state-line"><span class="status status-${escapeHtml(displayedStatus)}"><i></i>${escapeHtml(statusLabel(displayedStatus))}</span></div>
      <h1 id="problem-title">${escapeHtml(problem.title)}</h1>
      <div class="problem-author">
        ${authorAvatar(problem.owner)}
        <div><span>Problem author</span><strong title="${escapeHtml(problem.owner)}">${escapeHtml(authorName(problem.owner))}</strong></div>
      </div>
      <div class="description markdown-body">${renderMarkdown(problem.description)}</div>
      <div class="actions">
        <button class="primary" id="claim" type="button" ${canClaim && !busy ? "" : "disabled"}>${busy ? "Publishing…" : effectiveClaim ? "Claimed" : claimPending ? "Claim requested" : problem.status === "open" ? "Claim problem" : "Claim unavailable"}</button>
        <span>${hasChildren ? "Problems with children cannot be claimed." : claimPending ? "This rfm problem requires author or maintainer acknowledgement." : effectiveClaim ? "Work may begin immediately." : problem.status === "open" ? "Claim gives you 24 hours to send a PR." : "This problem is not available to claim."}</span>
      </div>
      ${claimDetails}
      <button class="related-action" id="report-related" type="button">+ Log new problem under this one</button>
    </section>
    <section class="related" aria-labelledby="related-title">
      <h2 id="related-title">Related · ${related.length}</h2>
      ${related.length ? `<ul>${related.map((coordinate) => `<li><button type="button" data-related="${coordinate}"><span>Problem ${escapeHtml(shortKey(coordinate.split(":")[2]))}</span><code>${escapeHtml(shortKey(coordinate))}</code></button></li>`).join("")}</ul>` : `<p>No related problem mentions found yet.</p>`}
    </section>
    <section class="discussion" aria-labelledby="discussion-title">
      <h2 id="discussion-title">Discussion · ${discussion.length} comment${discussion.length === 1 ? "" : "s"}${edits.length ? ` · ${edits.length} edit${edits.length === 1 ? "" : "s"}` : ""}</h2>
      <ol>${activity.length ? activity.map((item) => item.type === "revision" ? `<li class="revision-entry${item.revision.id === problem?.revisionId ? " current" : ""}">
        ${authorAvatar(item.revision.author)}
        <details${item.revision.id === problem?.revisionId ? " open" : ""}><summary><span class="history-summary"><span><strong class="activity-kind">Edit</strong><span class="status status-${escapeHtml(item.revision.status)}"><i></i>${escapeHtml(statusLabel(item.revision.status))}</span>${item.revision.id === problem?.revisionId ? '<strong class="current-label">Current</strong>' : ""}</span><strong>${escapeHtml(item.revision.title)}</strong><small><span title="${escapeHtml(item.revision.author)}">${escapeHtml(authorName(item.revision.author))}</span><time datetime="${new Date(item.revision.createdAt * 1000).toISOString()}" title="${new Date(item.revision.createdAt * 1000).toLocaleString()}">${formatRelativeTime(item.revision.createdAt)}</time><code title="${item.revision.id}">${shortKey(item.revision.id)}</code></small></span></summary>
        ${revisionChanges(item.revision, revisions)}</details>
      </li>` : `<li class="comment-entry-row">
        ${authorAvatar(item.result.event.pubkey)}
        <div><header><strong title="${escapeHtml(item.result.event.pubkey)}">${escapeHtml(authorName(item.result.event.pubkey))}</strong><time datetime="${new Date(item.result.event.created_at * 1000).toISOString()}" title="${new Date(item.result.event.created_at * 1000).toLocaleString()}">${formatRelativeTime(item.result.event.created_at)}</time></header><div class="markdown-body comment-body">${renderMarkdown(item.result.event.content)}</div></div>
      </li>`).join("") : `<li class="empty">No discussion or edit history yet.</li>`}</ol>
      <div class="comment-entry" id="comment-entry">
        <label class="sr-only" for="comment">Leave a comment</label>
        <textarea id="comment" rows="1" maxlength="4000" placeholder="Leave a comment…" ${pubkey && !busy ? "" : "disabled"}></textarea>
        <button id="post-comment" type="button" ${pubkey && !busy ? "" : "disabled"}>Post</button>
      </div>
    </section>
    <output id="app-status" aria-live="polite">${escapeHtml(liveMessage || (pubkey ? "" : "Sign in through shell to claim or comment."))}</output>
  </article>`;
  bind();
  void hydrateMedia(mediaRenderVersion);
  syncClaimCountdown(effectiveClaim?.expiresAt);
  if (!reducedMotion) gsap.fromTo(".problem-copy > *, .related, .discussion", { y: 9, opacity: 0 }, { y: 0, opacity: 1, duration: .38, stagger: .045, ease: "expo.out" });
}

function resetMedia(): void {
  mediaRenderVersion += 1;
  mediaObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  mediaObjectUrls.clear();
}

async function hydrateMedia(version: number): Promise<void> {
  const placeholders = [...document.querySelectorAll<HTMLElement>("[data-media-url]")];
  await Promise.all(placeholders.map(async (placeholder) => {
    const url = placeholder.dataset.mediaUrl;
    const alt = placeholder.dataset.mediaAlt || "Attached media";
    if (!url) return;
    try {
      const blob = await resource.bytes(url);
      if (version !== mediaRenderVersion || !placeholder.isConnected) return;
      if (!blob.type.startsWith("image/") && !blob.type.startsWith("video/")) {
        throw new Error(`Unsupported media type: ${blob.type || "unknown"}`);
      }
      const objectUrl = URL.createObjectURL(blob);
      mediaObjectUrls.add(objectUrl);
      const replaceDecodeFailure = (element: HTMLElement, kind: "image" | "video") => {
        console.warn(`Problem ${kind} decode failed`, { url, mimeType: blob.type });
        URL.revokeObjectURL(objectUrl);
        mediaObjectUrls.delete(objectUrl);
        const fallback = document.createElement("span");
        fallback.className = "markdown-media";
        fallback.dataset.state = "error";
        fallback.textContent = `${kind === "image" ? "Image" : "Video"} unavailable: ${alt}`;
        element.replaceWith(fallback);
      };
      if (blob.type.startsWith("image/")) {
        const image = document.createElement("img");
        image.className = "problem-media";
        image.src = objectUrl;
        image.alt = alt;
        image.addEventListener("error", () => replaceDecodeFailure(image, "image"), { once: true });
        placeholder.replaceWith(image);
        return;
      }
      const video = document.createElement("video");
      video.className = "problem-media";
      video.src = objectUrl;
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", alt);
      video.addEventListener("error", () => replaceDecodeFailure(video, "video"), { once: true });
      placeholder.replaceWith(video);
    } catch (error) {
      console.warn("Problem media load failed", { url, error });
      if (version !== mediaRenderVersion || !placeholder.isConnected) return;
      placeholder.dataset.state = "error";
      placeholder.replaceChildren(document.createTextNode(`Media unavailable: ${alt}`));
    }
  }));
}

function syncClaimCountdown(deadline?: number) {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = undefined;
  if (!deadline) return;
  const update = () => {
    const output = document.querySelector<HTMLElement>("[data-claim-deadline]");
    if (!output) return;
    const remaining = deadline - Date.now() / 1000;
    output.textContent = formatClaimCountdown(remaining);
    if (remaining > 0) return;
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = undefined;
  };
  update();
  if (deadline > Date.now() / 1000) countdownTimer = setInterval(update, 1000);
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
  document.querySelector("#edit-problem")?.addEventListener("click", () => void editProblem());
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
  if (action === "claim" && hasProblemChildren(problem.coordinate, relatedEvents)) {
    setLiveStatus("Problems with children cannot be claimed.");
    return;
  }
  busy = true;
  render();
  try {
    const result = await outbox.publish(buildWorkflowTemplate(problem, content, action), { toInboxes: [problem.owner] });
    const acceptedRelays = Object.entries(result.relays ?? {}).filter(([, accepted]) => accepted).map(([relay]) => relay);
    if (!result.event || (!result.ok && acceptedRelays.length === 0)) {
      throw new Error(result.error ?? "Shell could not publish the event.");
    }
    receiveDiscussion({ event: result.event, sidecar: { relayHints: acceptedRelays } });
    setLiveStatus(action ? (problem.status === "rfm" ? "Claim request published; awaiting acknowledgement." : "Problem claimed. You have 24 hours to send a PR.") : "Comment published.");
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

async function editProblem() {
  if (!problem || !mayEditProblem(problem, pubkey)) return;
  setLiveStatus("Opening problem editor…");
  try {
    const result = await intent.invoke({ archetype: "composer", action: "problem-edit", convention: "napplet:composer/problem-edit", payload: { problemId: problem.problemId }, behavior: { focus: true, reuse: true } });
    if (!result.ok || !result.handled) throw new Error(result.error ?? "No compatible problem editor is available.");
    setLiveStatus("Problem editor opened.");
  } catch (error) {
    console.error("Problem editor intent failed", { problemId: problem.problemId, error });
    setLiveStatus(error instanceof Error ? error.message : "Problem editor could not be opened.");
  }
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
  if (problem && result.event.kind === 31971) {
    try {
      problem = selectProblem(problem.coordinate, relatedEvents);
    } catch (error) {
      console.warn("Live problem revision could not become current", { coordinate: problem.coordinate, eventId: result.event.id, error });
      liveMessage = error instanceof Error ? error.message : "Live problem revision could not be applied.";
    }
  }
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
    const loadProfile = async (author: string) => {
      const profile = profileFromEvents(author, response.events.map(({ event }) => event));
      if (!profile) return;
      profiles.set(author, profile);
      const version = (avatarRequestVersions.get(author) ?? 0) + 1;
      avatarRequestVersions.set(author, version);
      avatarHandles.get(author)?.revoke();
      avatarHandles.delete(author);
      const resourceAvailable = Boolean((window as Window & { napplet?: { resource?: unknown } }).napplet?.resource);
      if (!profile.picture || !resourceAvailable) {
        if (profile.picture && !resourceAvailable) {
          console.warn("Profile picture unavailable; shell resource domain is missing", { author });
        }
        return;
      }
      try {
        const blob = await resource.bytes(profile.picture);
        if (!blob.type.startsWith("image/")) {
          console.warn("Profile picture rejected; resource is not an image", { author, picture: profile.picture, mimeType: blob.type });
          return;
        }
        const url = URL.createObjectURL(blob);
        if (avatarRequestVersions.get(author) !== version) {
          URL.revokeObjectURL(url);
          return;
        }
        avatarHandles.set(author, { url, revoke: () => URL.revokeObjectURL(url) });
        if (problem) render();
      } catch (error) {
        console.warn("Profile picture fetch failed; using generated avatar", { author, picture: profile.picture, error });
      }
    };
    const queue = [...missing];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const author = queue.shift();
        if (author) await loadProfile(author);
      }
    }));
    if (problem) render();
  } catch (error) {
    console.warn("Profile metadata query failed; using pubkey fallbacks", { authors: missing, error });
  }
}

async function loadProblem(value: string) {
  const status = document.querySelector<HTMLOutputElement>("#setup-status");
  let generation = loadGeneration;
  try {
    const target = parseCoordinate(value);
    if (status) status.textContent = "Loading current revision and discussion…";
    stopDiscussionSubscription();
    generation = loadGeneration;
    problem = undefined;
    comments = [];
    relatedEvents = [];
    related = [];
    liveMessage = "Syncing discussion and revisions…";
    const filters = [
      { kinds: [31971], "#d": [target.problemId] },
      { kinds: [COMMENT_KIND], "#A": [target.coordinate] },
      { kinds: [31971], "#a": [target.coordinate] }
    ];
    const receiveInitial = (result: RelayEventResult) => {
      if (generation !== loadGeneration) return;
      const collection = result.event.kind === COMMENT_KIND ? comments : relatedEvents;
      if (collection.some(({ event }) => event.id === result.event.id)) return;
      collection.push(result);
      if (result.event.kind === 31971) {
        try {
          problem = selectProblem(target.coordinate, relatedEvents);
        } catch (error) {
          console.warn("Cached problem revision set is not renderable yet", {
            coordinate: target.coordinate, eventId: result.event.id, error
          });
        }
      }
      if (!problem) return;
      related = relatedCoordinates(problem, [...comments, ...relatedEvents]);
      render();
      void loadProfiles([problem.owner, result.event.pubkey]);
    };
    const subscribe = (authors: string[]) => {
      const subscription = outbox.subscribe(filters, { authors, timeoutMs: 8000 });
      discussionSubscription = subscription;
      subscription.on("event", (result) => {
        if (discussionSubscription !== subscription) return;
        receiveInitial(result);
      });
      subscription.on("closed", (reason) => {
        if (discussionSubscription !== subscription) return;
        discussionSubscription = undefined;
        console.warn("Live problem subscription closed", { coordinate: target.coordinate, reason });
        setLiveStatus("Live updates stopped. Reopen problem to reconnect.");
      });
      return subscription;
    };
    let subscription = subscribe([target.owner]);
    const problemFilter = { kinds: [31971], "#d": [target.problemId], limit: 200 };
    const [problemResponse, response] = await Promise.all([
      outbox.query(problemFilter, { authors: [target.owner], limit: 200, timeoutMs: 8000 }),
      outbox.query(filters.slice(1), { authors: [target.owner], limit: 300, timeoutMs: 8000 })
    ]);
    if (generation !== loadGeneration) return;
    let problemResults = problemResponse.events;
    const initialProblem = selectProblem(target.coordinate, problemResults);
    const routedAuthors = problemRevisionAuthors(initialProblem);
    if (routedAuthors.some((author) => author !== target.owner)) {
      const previousSubscription = subscription;
      subscription = subscribe(routedAuthors);
      previousSubscription.close();
      const routedResponse = await outbox.query(problemFilter, { authors: routedAuthors, limit: 200, timeoutMs: 8000 });
      if (generation !== loadGeneration) return;
      problemResults = [...problemResults, ...routedResponse.events];
    }
    const initialRelated = response.events;
    const childProblemIds = [...new Set(initialRelated.flatMap(({ event }) => event.kind === 31971 &&
      event.tags.some((item) => item[0] === "a" && item[3] === undefined && item[1] === target.coordinate)
      ? event.tags.filter((item) => item[0] === "d").map((item) => item[1]) : []))];
    const childRevisions = childProblemIds.length
      ? (await outbox.query({ kinds: [31971], "#d": childProblemIds, limit: 300 }, { limit: 300, timeoutMs: 8000 })).events
      : [];
    if (generation !== loadGeneration) return;
    const allResults = [...problemResults, ...initialRelated, ...childRevisions];
    const uniqueResults = Array.from(new Map(allResults.map((result) => [result.event.id, result])).values());
    relatedEvents = uniqueResults.filter(({ event }) => event.kind === 31971);
    problem = selectProblem(target.coordinate, relatedEvents);
    comments = uniqueResults.filter(({ event }) => event.kind === COMMENT_KIND);
    related = relatedCoordinates(problem, [...comments, ...relatedEvents]);
    liveMessage = "";
    render();
    const effectiveClaim = selectEffectiveClaim(problem, comments, problemRevisionHistory(problem.coordinate, relatedEvents));
    void loadProfiles([
      problem.owner,
      ...comments.map(({ event }) => event.pubkey),
      ...relatedEvents.filter(({ event }) => event.kind === 31971).map(({ event }) => event.pubkey),
      ...(effectiveClaim ? [effectiveClaim.claimant] : [])
    ]);
  } catch (error) {
    if (generation !== loadGeneration) return;
    console.error("Problem load failed", { value, error });
    showSetup(error instanceof Error ? error.message : "Problem could not be loaded.");
  }
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
  showSetup();
  try {
    intentSubscription = inc.on("napplet:note/open", (event) => {
      intentReceived = true;
      if (!isNoteOpenPayload(event.payload)) {
        showSetup("Incoming problem-open request has an invalid event target.");
        return;
      }
      showLoadingProblem();
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
    if (!intentReceived && !problem) showSetup(liveMessage);
  }
}

addEventListener("beforeunload", () => {
  discussionSubscription?.close(); identitySubscription?.close(); intentSubscription?.close();
  if (countdownTimer) clearInterval(countdownTimer);
  avatarHandles.forEach((handle) => handle.revoke());
  avatarRequestVersions.clear();
  resetMedia();
});
void start();
