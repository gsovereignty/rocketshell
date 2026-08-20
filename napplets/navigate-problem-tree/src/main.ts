/*
  DIRECTION: Quiet operations index. Dense split view treats DAG as working
  navigation: rooted path outline left, direct next moves right, electric blue
  reserved for current position. Approved reference: user screenshot.
  FORM: Split outline/list, user-pinned composition; no seed assignment.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/
import { intent, outbox } from "@napplet/sdk";
import { gsap } from "gsap";
import "./styles.css";
import {
  ROOT_A_TAG, assertRootCoordinate, buildProblemDag, descendantsCount, statusLabel,
  type ProblemDag, type ProblemNode, type ProblemStatus
} from "./problem-dag";

const app = (() => {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Application root is missing.");
  return element;
})();

let dag: ProblemDag | undefined;
let selected = "";
let activeFilter = "all";
let noteHandlerAvailable = false;

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
})[character]!);

const externalIcon = `<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M11 3h6v6M9 11l8-8M16 11v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>`;

function showSetup(message = "") {
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
  const children = (dag.children.get(selected) ?? []).map((coordinate) => dag!.nodes.get(coordinate)!).filter(Boolean);
  const visible = activeFilter === "all" ? children : children.filter((node) => node.status === activeFilter);
  const list = document.querySelector<HTMLElement>("#problem-list");
  const filters = document.querySelector<HTMLElement>("#filters");
  const sectionTitle = document.querySelector<HTMLElement>("#section-title");
  if (!list || !filters || !sectionTitle) return;
  sectionTitle.textContent = parent.coordinate === dag.rootCoordinate ? "Ground-level problems" : `Children of ${parent.title}`;
  filters.innerHTML = filterCounts(children).map(([value, label, count]) => `
    <button data-filter="${value}" aria-pressed="${activeFilter === value}">${label} <span>${count}</span></button>`).join("");
  list.innerHTML = visible.length ? visible.map((node, index) => `
    <li class="problem-row${node.coordinate === selected ? " selected" : ""}">
      <button class="row-main" data-select="${node.coordinate}">
        <span class="rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="row-title">${escapeHtml(node.title)}</span>
        ${node.forkCount ? `<span class="fork">${node.forkCount + 1} heads</span>` : ""}
        <span class="status status-${node.status}">${statusLabel(node.status)}</span>
      </button>
      <button class="open-problem" data-open="${node.coordinate}" ${noteHandlerAvailable ? "" : "disabled"}
        aria-label="Open ${escapeHtml(node.title)} in note viewer" title="${noteHandlerAvailable ? "Open in note viewer" : "No note viewer available"}">${externalIcon}</button>
    </li>`).join("") : `<li class="empty">${children.length ? "No children match this filter." : "This problem has no direct children."}</li>`;
  gsap.fromTo(".problem-row", { x: 10, opacity: 0 }, { x: 0, opacity: 1, duration: .3, stagger: .025, ease: "expo.out" });
}

function renderApp() {
  if (!dag) return;
  app.innerHTML = `
    <div class="workspace">
      <aside class="tree-pane" aria-labelledby="tree-title">
        <header><h1 id="tree-title">Problem tree</h1><button id="change-root">Change root</button></header>
        <nav aria-label="Problem DAG"><ul class="tree-root">${outlineBranch(dag.rootCoordinate, new Set())}</ul></nav>
      </aside>
      <section class="list-pane" aria-labelledby="section-title">
        <header class="list-header"><h2 id="section-title"></h2><div id="filters" class="filters" aria-label="Filter children"></div></header>
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
    } else if (filterButton?.dataset.filter) {
      activeFilter = filterButton.dataset.filter;
      renderList();
    } else if (openButton?.dataset.open) {
      void openProblem(openButton.dataset.open);
    } else if (target.closest("#change-root")) showSetup();
  };
}

async function openProblem(coordinate: string) {
  const node = dag?.nodes.get(coordinate);
  const status = document.querySelector<HTMLOutputElement>("#app-status");
  if (!node || !status) return;
  status.textContent = "Opening selected problem…";
  try {
    const result = await intent.open("note", { target: { type: "event", id: node.revisionId } }, {
      convention: "napplet:note/open", behavior: { focus: true, reuse: true }
    });
    if (!result.ok || !result.handled) throw new Error(result.error ?? "No note viewer accepted this problem.");
    status.textContent = "Problem opened in note viewer.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Problem could not be opened.";
  }
}

async function loadDag(value: string) {
  const status = document.querySelector<HTMLOutputElement>("#setup-status");
  const submit = document.querySelector<HTMLButtonElement>("#root-form button");
  try {
    const coordinate = assertRootCoordinate(value);
    if (status) status.textContent = "Loading problem structure…";
    if (submit) submit.disabled = true;
    const [{ events }, availability] = await Promise.all([
      outbox.query([{ kinds: [31971], "#A": [coordinate] }], { timeoutMs: 8000 }),
      intent.available("note").catch(() => undefined)
    ]);
    dag = buildProblemDag(coordinate, events);
    selected = coordinate;
    noteHandlerAvailable = availability?.available === true;
    renderApp();
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "Problem DAG could not be loaded.";
    if (submit) submit.disabled = false;
  }
}

if (ROOT_A_TAG) void loadDag(ROOT_A_TAG);
else showSetup();
