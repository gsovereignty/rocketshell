/*
  DIRECTION: Quiet operations index. Dense split view treats DAG as working
  navigation: rooted path outline left, direct next moves right, electric blue
  reserved for current position. Approved reference: user screenshot.
  FORM: Split outline/list, user-pinned composition; no seed assignment.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/
import { intent, outbox, type OutboxSubscription, type RelayEventResult } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import {
  ROOT_A_TAG, assertRootCoordinate, buildProblemDag, descendantsCount, leafDescendants, statusLabel, visibleTreeRoots,
  type ProblemDag, type ProblemNode, type ProblemStatus
} from "./problem-dag";
import {
  PROBLEM_CHILD_ACTION, PROBLEM_CHILD_ARCHETYPE, PROBLEM_CHILD_CONVENTION,
  hasProblemChildComposer, hasProblemViewer, openProblemViewer
} from "./problem-child-intent";
import { mergeProblemEvents } from "./problem-events";

const app = (() => {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Application root is missing.");
  return element;
})();

let dag: ProblemDag | undefined;
let selected = "";
let activeFilter = "all";
let noteHandlerAvailable = false;
let problemChildHandlerAvailable = false;
let childComposerBusy = false;
let problemViewerBusy = false;
let problemEvents: RelayEventResult[] = [];
let problemSubscription: OutboxSubscription | undefined;
let loadGeneration = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
})[character]!);

const externalIcon = `<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M11 3h6v6M9 11l8-8M16 11v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>`;

function showSetup(message = "") {
  stopProblemSubscription();
  app.innerHTML = `
    <section class="setup" aria-labelledby="setup-title">
      <div class="setup-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="setup-copy">
        <h1 id="setup-title">Choose problem root</h1>
        <p>Enter full root problem coordinate. Navigator loads only structure belonging to that DAG.</p>
      </div>
      <div id="root-form">
        <label for="root-coordinate">Root problem a-tag</label>
        <div class="coordinate-entry">
          <input id="root-coordinate" name="root" required autocomplete="off" spellcheck="false"
            placeholder="31971:owner-pubkey:problem-id" aria-describedby="setup-status">
          <button type="button">Load DAG</button>
        </div>
        <output id="setup-status" class="setup-status" aria-live="polite">${escapeHtml(message)}</output>
      </div>
    </section>`;
  const input = document.querySelector<HTMLInputElement>("#root-coordinate");
  const submit = document.querySelector<HTMLButtonElement>("#root-form button");
  const loadRoot = () => {
    if (input) void loadDag(input.value);
  };
  submit?.addEventListener("click", loadRoot);
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadRoot();
  });
  gsap.fromTo(".setup > *", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .07, ease: "expo.out" });
}

function stopProblemSubscription() {
  loadGeneration += 1;
  problemSubscription?.close();
  problemSubscription = undefined;
}

function receiveProblemEvents(rootCoordinate: string, incoming: RelayEventResult[]) {
  const merged = mergeProblemEvents(problemEvents, incoming);
  problemEvents = merged.events;
  if (!merged.changed || !dag || dag.rootCoordinate !== rootCoordinate) return;
  dag = buildProblemDag(rootCoordinate, problemEvents);
  if (!dag.nodes.has(selected)) selected = rootCoordinate;
  renderApp();
}

function outlineBranch(coordinate: string, trail: Set<string>, depth = 0): string {
  if (!dag || trail.has(coordinate)) return "";
  const node = dag.nodes.get(coordinate);
  if (!node) return "";
  const nextTrail = new Set(trail).add(coordinate);
  const children = dag.children.get(coordinate) ?? [];
  const isSelected = selected === coordinate;
  return `<li class="branch" style="--depth:${depth}">
    <button class="tree-node${isSelected ? " selected" : ""}" data-select="${coordinate}" aria-current="${isSelected ? "true" : "false"}">
      <span>${escapeHtml(node.title)}</span>
      <span class="node-meta">${node.forkCount ? `<b>${node.forkCount + 1} heads</b>` : ""}<small>${descendantsCount(dag, coordinate)}</small></span>
    </button>
    ${children.length ? `<ul>${children.map((child) => outlineBranch(child, nextTrail, depth + 1)).join("")}</ul>` : ""}
  </li>`;
}

function filterCounts(nodes: ProblemNode[]) {
  const count = (status: ProblemStatus) => nodes.filter((node) => node.status === status).length;
  return [
    ["all", "All", nodes.length], ["open", "Open", count("open")],
    ["claimed", "Claimed", count("claimed")], ["patched", "Patched", count("patched")],
    ["closed", "Closed", count("closed")]
  ] as const;
}

function renderList() {
  if (!dag) return;
  const parent = dag.nodes.get(selected);
  if (!parent) return;
  const actionable = leafDescendants(dag, selected);
  const visible = activeFilter === "all" ? actionable : actionable.filter((node) => node.status === activeFilter);
  const list = document.querySelector<HTMLElement>("#problem-list");
  const filters = document.querySelector<HTMLElement>("#filters");
  const sectionTitle = document.querySelector<HTMLElement>("#section-title");
  const logChildButton = document.querySelector<HTMLButtonElement>("#log-child");
  const openSelectedButton = document.querySelector<HTMLButtonElement>("#open-selected");
  if (!list || !filters || !sectionTitle || !logChildButton || !openSelectedButton) return;
  sectionTitle.textContent = "Actionable problems";
  openSelectedButton.disabled = !noteHandlerAvailable || problemViewerBusy;
  openSelectedButton.textContent = problemViewerBusy ? "Opening problem…" : "Open selected problem";
  openSelectedButton.title = noteHandlerAvailable
    ? `Open ${parent.title} in problem viewer`
    : "Problem viewer is not installed";
  logChildButton.disabled = !problemChildHandlerAvailable || childComposerBusy;
  logChildButton.title = problemChildHandlerAvailable
    ? `Log a child problem under ${parent.title}`
    : "No compatible problem composer available";
  filters.innerHTML = filterCounts(actionable).map(([value, label, count]) => `
    <button data-filter="${value}" aria-pressed="${activeFilter === value}">${label} <span>${count}</span></button>`).join("");
  list.innerHTML = visible.length ? visible.map((node, index) => `
    <li class="problem-row${node.coordinate === selected ? " selected" : ""}">
      <button class="row-main" data-select="${node.coordinate}">
        <span class="rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="row-title">${escapeHtml(node.title)}</span>
        ${node.forkCount ? `<span class="fork">${node.forkCount + 1} heads</span>` : ""}
        <span class="status status-${node.status}">${statusLabel(node.status)}</span>
      </button>
      <button class="open-problem" data-open="${node.coordinate}" ${noteHandlerAvailable && !problemViewerBusy ? "" : "disabled"}
        aria-label="Open ${escapeHtml(node.title)} in problem viewer" title="${noteHandlerAvailable ? "Open problem details" : "Problem viewer is not installed"}">${externalIcon}</button>
    </li>`).join("") : `<li class="empty">${actionable.length ? "No actionable problems match this filter." : "No leaf problems below this problem."}</li>`;
  const rows = list.querySelectorAll<HTMLElement>(".problem-row");
  if (!reducedMotion.matches && rows.length > 0) {
    gsap.fromTo(rows, { x: 10, opacity: 0 }, { x: 0, opacity: 1, duration: .3, stagger: .025, ease: "expo.out" });
  }
}

function renderApp() {
  if (!dag) return;
  const currentDag = dag;
  app.innerHTML = `
    <div class="workspace">
      <aside class="tree-pane" aria-labelledby="tree-title">
        <header><h1 id="tree-title">Problem tree</h1><button id="change-root">Change root</button></header>
        <nav aria-label="Problem DAG"><ul class="tree-root">${visibleTreeRoots(currentDag)
          .map((coordinate) => outlineBranch(coordinate, new Set([currentDag.rootCoordinate])))
          .join("")}</ul></nav>
      </aside>
      <section class="list-pane" aria-labelledby="section-title">
        <header class="list-header">
          <div class="list-heading"><h2 id="section-title"></h2><div class="list-actions"><button id="open-selected" type="button">Open selected problem</button><button id="log-child" type="button">Log child problem</button></div></div>
          <div id="filters" class="filters" aria-label="Filter children"></div>
        </header>
        <ol id="problem-list" class="problem-list"></ol>
        <output id="app-status" class="app-status" aria-live="polite"></output>
      </section>
    </div>`;
  bindWorkspace();
  renderList();
  gsap.fromTo(".workspace", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: .62, ease: "expo.out" });
}

function bindWorkspace() {
  app.onclick = (event) => {
    const target = event.target as Element;
    const selectButton = target.closest<HTMLButtonElement>("[data-select]");
    const filterButton = target.closest<HTMLButtonElement>("[data-filter]");
    const openButton = target.closest<HTMLButtonElement>("[data-open]");
    if (selectButton?.dataset.select) {
      selected = selectButton.dataset.select;
      activeFilter = "all";
      renderApp();
      void openProblem(selected);
    } else if (filterButton?.dataset.filter) {
      activeFilter = filterButton.dataset.filter;
      renderList();
    } else if (openButton?.dataset.open) {
      void openProblem(openButton.dataset.open);
    } else if (target.closest("#open-selected")) {
      void openProblem(selected);
    } else if (target.closest("#log-child")) {
      void logChildProblem();
    } else if (target.closest("#change-root")) showSetup();
  };
}

async function logChildProblem() {
  const node = dag?.nodes.get(selected);
  const status = document.querySelector<HTMLOutputElement>("#app-status");
  const button = document.querySelector<HTMLButtonElement>("#log-child");
  if (!node || !status || !button || childComposerBusy) return;
  childComposerBusy = true;
  button.disabled = true;
  button.textContent = "Opening composer…";
  status.textContent = `Opening child composer for ${node.title}…`;
  try {
    const result = await intent.invoke({
      archetype: PROBLEM_CHILD_ARCHETYPE,
      action: PROBLEM_CHILD_ACTION,
      convention: PROBLEM_CHILD_CONVENTION,
      payload: { problemId: node.problemId },
      behavior: { focus: true, reuse: true }
    });
    if (!result.ok || !result.handled) throw new Error(result.error ?? "No problem composer accepted this request.");
    status.textContent = `Child composer opened under ${node.title}.`;
    gsap.fromTo(button, { scale: .97 }, { scale: 1, duration: .2, ease: "expo.out" });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Problem composer could not be opened.";
  } finally {
    childComposerBusy = false;
    button.textContent = "Log child problem";
    button.disabled = !problemChildHandlerAvailable;
  }
}

async function openProblem(coordinate: string) {
  const node = dag?.nodes.get(coordinate);
  const status = document.querySelector<HTMLOutputElement>("#app-status");
  if (!node || !status || problemViewerBusy) return;
  if (!noteHandlerAvailable) {
    status.textContent = "Problem viewer is not installed.";
    return;
  }
  problemViewerBusy = true;
  renderList();
  status.textContent = `Opening ${node.title}…`;
  try {
    const result = await openProblemViewer(intent, node.revisionId);
    if (!result.ok || !result.handled) throw new Error(result.error ?? "View Problem did not accept this problem.");
    status.textContent = `${node.title} opened in problem viewer.`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Problem could not be opened.";
  } finally {
    problemViewerBusy = false;
    renderList();
  }
}

async function loadDag(value: string) {
  const status = document.querySelector<HTMLOutputElement>("#setup-status");
  const submit = document.querySelector<HTMLButtonElement>("#root-form button");
  let generation = loadGeneration;
  try {
    const coordinate = assertRootCoordinate(value);
    stopProblemSubscription();
    generation = loadGeneration;
    problemEvents = [];
    dag = undefined;
    if (status) status.textContent = "Loading problem structure…";
    if (submit) submit.disabled = true;
    const filters = [{ kinds: [31971], "#A": [coordinate] }];
    const subscription = outbox.subscribe(filters, { timeoutMs: 8000 });
    problemSubscription = subscription;
    subscription.on("event", (result) => {
      if (problemSubscription === subscription) receiveProblemEvents(coordinate, [result]);
    });
    subscription.on("closed", (reason) => {
      if (problemSubscription !== subscription) return;
      problemSubscription = undefined;
      console.warn("Live problem tree subscription closed", { rootCoordinate: coordinate, reason });
      const liveStatus = document.querySelector<HTMLOutputElement>("#app-status");
      if (liveStatus) liveStatus.textContent = "Live updates stopped. Reload tree to reconnect.";
    });
    const [{ events }, noteAvailability, childAvailability] = await Promise.all([
      outbox.query(filters, { timeoutMs: 8000 }),
      intent.available("note").catch((error) => {
        console.warn("Problem viewer availability check failed", { archetype: "note", error });
        return undefined;
      }),
      intent.available(PROBLEM_CHILD_ARCHETYPE).catch((error) => {
        console.warn("Problem composer availability check failed", { archetype: PROBLEM_CHILD_ARCHETYPE, error });
        return undefined;
      })
    ]);
    if (generation !== loadGeneration) return;
    problemEvents = mergeProblemEvents(problemEvents, events).events;
    dag = buildProblemDag(coordinate, problemEvents);
    selected = coordinate;
    noteHandlerAvailable = hasProblemViewer(noteAvailability);
    problemChildHandlerAvailable = hasProblemChildComposer(childAvailability);
    renderApp();
  } catch (error) {
    if (generation !== loadGeneration) return;
    stopProblemSubscription();
    if (status) status.textContent = error instanceof Error ? error.message : "Problem DAG could not be loaded.";
    if (submit) submit.disabled = false;
  }
}

if (ROOT_A_TAG) void loadDag(ROOT_A_TAG);
else showSetup();
