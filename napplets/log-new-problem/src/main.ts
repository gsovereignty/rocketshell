import { identity, inc, outbox } from "@napplet/sdk";
import type { Subscription } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import {
  CHILD_CONVENTION, HEX_64, buildProblemTemplate, createProblemId, isChildPayload,
  resolveParent, type ParentContext, type ProblemDraft, type ProblemStatus
} from "./problem";
import { publishSuccessMessage } from "./publish-result";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root is missing.");

root.innerHTML = `
  <article class="sheet">
    <header class="masthead">
      <div><p class="eyebrow">Problem record · NIP-1971</p><h1>Log new problem</h1></div>
      <span class="mode" id="mode">Root</span>
    </header>
    <section class="parent-card" id="parent-card" hidden aria-live="polite">
      <div><span class="micro">Child of</span><strong id="parent-title">Loading parent…</strong></div>
      <code id="parent-id"></code>
    </section>
    <form id="problem-form" novalidate>
      <div class="field">
        <label for="title">What is the problem?</label>
        <input id="title" name="title" maxlength="160" required autocomplete="off" placeholder="Short, specific title">
        <span class="hint">Name the undesirable condition, not a proposed fix.</span>
      </div>
      <div class="field">
        <label for="description">What is happening?</label>
        <textarea id="description" name="description" rows="8" maxlength="12000" required placeholder="Describe current behavior, impact, and enough context to understand the problem."></textarea>
        <span class="hint"><output id="count">0</output> / 12,000</span>
      </div>
      <details id="advanced">
        <summary><span>Protocol options</span><span class="summary-note">Optional</span></summary>
        <div class="advanced-grid">
          <div class="field"><label for="status">Initial status</label><select id="status" name="status">
            <option value="open">Open</option><option value="rfm">Request For Maintainers</option>
            <option value="draft">Draft</option><option value="big">Big</option>
            <option value="children">Needs children</option><option value="closed">Closed</option>
          </select></div>
          <div class="field"><label for="child-status">Default child status</label><select id="child-status" name="childStatus">
            <option value="">Not specified</option><option value="open">Open</option><option value="rfm">Request For Maintainers</option>
          </select></div>
          <div class="field span-2"><label for="maintainers">Maintainers</label><textarea id="maintainers" name="maintainers" rows="2" placeholder="One 64-character hex pubkey per line"></textarea></div>
          <fieldset class="span-2"><legend>Optional context</legend>
            <div class="context-row"><span>Rocket</span><input name="rocketOwner" aria-label="Rocket owner pubkey" placeholder="owner pubkey"><input name="rocketId" aria-label="Rocket ID" placeholder="rocket ID"><input name="rocketRelay" aria-label="Rocket relay" placeholder="wss:// relay hint"></div>
            <div class="context-row"><span>Repository</span><input name="repoOwner" aria-label="Repository owner pubkey" placeholder="owner pubkey"><input name="repoId" aria-label="Repository ID" placeholder="repository ID"><input name="repoRelay" aria-label="Repository relay" placeholder="wss:// relay hint"></div>
            <div class="context-row bitcoin"><span>Bitcoin</span><input name="height" inputmode="numeric" aria-label="Bitcoin block height" placeholder="block height"><input name="blockHash" aria-label="Bitcoin block hash" placeholder="block hash"></div>
          </fieldset>
        </div>
      </details>
      <footer class="action-rail">
        <output id="status-line" role="status" aria-live="polite">Connecting to shell…</output>
        <button id="publish" type="button" disabled><span>Publish problem</span><span aria-hidden="true">↗</span></button>
      </footer>
    </form>
  </article>`;

const form = document.querySelector<HTMLFormElement>("#problem-form")!;
const publishButton = document.querySelector<HTMLButtonElement>("#publish")!;
const statusLine = document.querySelector<HTMLOutputElement>("#status-line")!;
const description = document.querySelector<HTMLTextAreaElement>("#description")!;
const count = document.querySelector<HTMLOutputElement>("#count")!;
const parentCard = document.querySelector<HTMLElement>("#parent-card")!;
const parentTitle = document.querySelector<HTMLElement>("#parent-title")!;
const parentId = document.querySelector<HTMLElement>("#parent-id")!;
const mode = document.querySelector<HTMLElement>("#mode")!;
const advanced = document.querySelector<HTMLDetailsElement>("#advanced")!;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let pubkey = "";
let parent: ParentContext | undefined;
let childRequestPending = false;
let intentSubscription: Subscription | undefined;

const animate = (target: gsap.TweenTarget, vars: gsap.TweenVars) => {
  if (reducedMotion) return;
  gsap.fromTo(target, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out", ...vars });
};

function setStatus(message: string, state: "idle" | "busy" | "error" | "success" = "idle") {
  statusLine.textContent = message;
  statusLine.dataset.state = state;
}

async function loadParent(problemIdValue: string) {
  childRequestPending = true;
  parent = undefined;
  mode.textContent = "Child";
  parentCard.hidden = false;
  parentTitle.textContent = "Resolving parent…";
  parentId.textContent = problemIdValue;
  publishButton.disabled = true;
  setStatus("Looking up parent problem…", "busy");
  animate(parentCard, {});
  try {
    const response = await outbox.query({ kinds: [31971], "#d": [problemIdValue], limit: 200 }, { limit: 200, timeoutMs: 8000 });
    parent = resolveParent(problemIdValue, response.events);
    parentTitle.textContent = parent.title;
    parentId.textContent = parent.problemId;
    const status = document.querySelector<HTMLSelectElement>("#status")!;
    status.value = parent.defaultChildStatus;
    childRequestPending = false;
    publishButton.disabled = !pubkey;
    setStatus("Parent resolved. Ready to publish child.");
  } catch (error) {
    childRequestPending = false;
    parentTitle.textContent = "Parent unavailable";
    setStatus(error instanceof Error ? error.message : "Parent lookup failed.", "error");
  }
}

function optionalContext(data: FormData, prefix: "rocket" | "repo") {
  const owner = String(data.get(`${prefix}Owner`) ?? "").trim();
  const id = String(data.get(`${prefix}Id`) ?? "").trim();
  const relay = String(data.get(`${prefix}Relay`) ?? "").trim();
  if (!owner && !id && !relay) return undefined;
  if (!HEX_64.test(owner) || !id || (relay && !relay.startsWith("wss://"))) {
    throw new Error(`${prefix === "rocket" ? "Rocket" : "Repository"} context is incomplete or invalid.`);
  }
  return { owner, id, relay };
}

function readDraft(data: FormData): ProblemDraft {
  const title = String(data.get("title") ?? "").trim();
  const body = String(data.get("description") ?? "").trim();
  if (!title) throw new Error("Add a problem title.");
  if (!body) throw new Error("Add a complete problem description.");
  const maintainers = String(data.get("maintainers") ?? "").split(/\s+/).filter(Boolean);
  if (maintainers.some((value) => !HEX_64.test(value))) throw new Error("Each maintainer must be a 64-character lowercase hex pubkey.");
  const height = String(data.get("height") ?? "").trim();
  const hash = String(data.get("blockHash") ?? "").trim();
  if ((height || hash) && (!/^\d+$/.test(height) || !HEX_64.test(hash))) throw new Error("Bitcoin context requires block height and 64-character lowercase hash.");
  return {
    title, description: body, status: String(data.get("status")) as ProblemStatus,
    childStatus: (String(data.get("childStatus") ?? "") || undefined) as ProblemDraft["childStatus"],
    maintainers, rocket: optionalContext(data, "rocket"), repository: optionalContext(data, "repo"),
    bitcoin: height && hash ? { height, hash } : undefined
  };
}

description.addEventListener("input", () => { count.value = String(description.value.length); });
advanced.addEventListener("toggle", () => {
  if (advanced.open) animate(advanced.querySelector(".advanced-grid"), { duration: 0.24 });
});

async function publishProblem() {
  if (childRequestPending) return;
  publishButton.disabled = true;
  setStatus("Preparing event for shell approval…", "busy");
  try {
    const draft = readDraft(new FormData(form));
    const random = crypto.getRandomValues(new Uint8Array(32));
    const template = buildProblemTemplate(pubkey, createProblemId(random), draft, Math.floor(Date.now() / 1000), parent);
    const recipients = parent ? Array.from(new Set([parent.owner, parent.rootOwner])) : [];
    const result = await outbox.publish(template, recipients.length ? { toInboxes: recipients } : undefined);
    setStatus(publishSuccessMessage(result), "success");
    form.reset();
    count.value = "0";
    animate(statusLine, {});
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Problem could not be published.", "error");
  } finally {
    publishButton.disabled = !pubkey || childRequestPending || (mode.textContent === "Child" && !parent);
  }
}

publishButton.addEventListener("click", () => { void publishProblem(); });
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void publishProblem();
});

async function start() {
  try {
    intentSubscription = inc.on(CHILD_CONVENTION, (event) => {
      if (!isChildPayload(event.payload)) {
        setStatus("Incoming child request has an invalid problem ID.", "error");
        return;
      }
      void loadParent(event.payload.problemId);
    });
    pubkey = await identity.getPublicKey() ?? "";
    if (!HEX_64.test(pubkey)) throw new Error("Sign in through shell to publish a problem.");
    publishButton.disabled = false;
    setStatus("Ready to publish a root problem.");
    animate(".sheet", { duration: 0.4 });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Required shell capabilities are unavailable.", "error");
  }
}

addEventListener("beforeunload", () => intentSubscription?.close());
void start();
