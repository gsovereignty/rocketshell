import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export type ResourceLoader = (url: string, signal: AbortSignal) => Promise<Blob>;
export type ErrorReporter = (operation: string, error: unknown, details?: Readonly<Record<string, string>>) => void;

const IMAGE = /!\[([^\]]*)\]\((https:\/\/[^\s)]+|blossom:[^\s)]+|htree:[^\s)]+|nostr:[^\s)]+|data:[^\s)]+)\)/g;
const LINK = /(?<!!)\[([^\]]+)\]\(([^\s)]+)\)/g;
const CODE_FENCE = /```([^\n`]*)\n([\s\S]*?)\n```/g;

type CacheEntry = { controller: AbortController; promise: Promise<string>; refs: number; objectUrl?: string };

export class ResourcePreviewCache {
  private readonly entries = new Map<string, CacheEntry>();
  constructor(private readonly load: ResourceLoader) {}
  acquire(source: string): Promise<string> {
    const existing = this.entries.get(source);
    if (existing) { existing.refs += 1; return existing.promise; }
    const controller = new AbortController();
    const entry: CacheEntry = { controller, refs: 1, promise: Promise.resolve("") };
    entry.promise = this.load(source, controller.signal).then((blob) => {
      if (!blob.type.startsWith("image/")) throw new Error(`Unsupported preview type: ${blob.type || "unknown"}`);
      if (entry.refs === 0) return "";
      entry.objectUrl = URL.createObjectURL(blob);
      return entry.objectUrl;
    }).catch((error: unknown) => {
      this.entries.delete(source);
      throw error;
    });
    this.entries.set(source, entry);
    return entry.promise;
  }
  release(source: string): void {
    const entry = this.entries.get(source);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs) return;
    entry.controller.abort();
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    this.entries.delete(source);
  }
  destroy(): void {
    for (const [source, entry] of this.entries) {
      entry.refs = 1;
      this.release(source);
    }
  }
}

const fencedRanges = (source: string) => [...source.matchAll(CODE_FENCE)].map((match) => ({ from: match.index, to: match.index + match[0].length }));
const insideAny = (from: number, to: number, ranges: readonly { from: number; to: number }[]) => ranges.some((range) => from < range.to && to > range.from);
const selectionTouches = (state: EditorState, from: number, to: number) => state.selection.main.from <= to && state.selection.main.to >= from;

const KEYWORDS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(Object.entries({
  javascript: "async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
  typescript: "abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function if implements import in infer instanceof interface keyof let module namespace never new null number object of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield",
  json: "true false null",
  shell: "case do done elif else esac export fi for function if in local readonly return set then unset while",
  html: "doctype html head body main section article div span a img button input label table tr td th script style",
  css: "important media supports keyframes from to var calc color-mix grid flex block inline none inherit initial",
  markdown: "",
  python: "and as assert async await break class continue def del elif else except false finally for from global if import in is lambda none nonlocal not or pass raise return true try while with yield",
  rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while"
}).map(([name, words]) => [name, new Set(words.split(" ").filter(Boolean))]));
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", bash: "shell", sh: "shell", py: "python", rs: "rust", md: "markdown" };

function appendHighlighted(code: string, language: string, target: HTMLElement): void {
  const normalized = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const keywords = KEYWORDS[normalized] ?? new Set<string>();
  const token = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  let offset = 0;
  for (const match of code.matchAll(token)) {
    if (match.index > offset) target.append(document.createTextNode(code.slice(offset, match.index)));
    const value = match[0];
    const span = document.createElement("span");
    if (/^(?:\/\/|#|\/\*)/.test(value)) span.className = "tok-comment";
    else if (/^["'`]/.test(value)) span.className = "tok-string";
    else if (/^\d/.test(value)) span.className = "tok-number";
    else if (keywords.has(value.toLowerCase())) span.className = "tok-keyword";
    span.textContent = value;
    target.append(span);
    offset = match.index + value.length;
  }
  if (offset < code.length) target.append(document.createTextNode(code.slice(offset)));
}

class CodeFenceWidget extends WidgetType {
  constructor(private readonly code: string, private readonly language: string, private readonly from: number, private readonly report: ErrorReporter) { super(); }
  eq(other: CodeFenceWidget): boolean { return other.code === this.code && other.language === this.language && other.from === this.from; }
  toDOM(view: EditorView): HTMLElement {
    const frame = document.createElement("section");
    frame.className = "napplet-md-code";
    const bar = document.createElement("div");
    bar.className = "napplet-md-codebar";
    const language = document.createElement("span");
    language.textContent = this.language || "text";
    const actions = document.createElement("span");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit source";
    edit.addEventListener("click", () => { view.dispatch({ selection: { anchor: this.from + 3 + this.language.length + 1 }, scrollIntoView: true }); view.focus(); });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      if (!navigator.clipboard?.writeText) {
        this.report("copy code block", new Error("Clipboard API unavailable in this sandbox."), { language: this.language || "text" });
        copy.textContent = "Copy unavailable";
        return;
      }
      void navigator.clipboard.writeText(this.code).then(() => { copy.textContent = "Copied"; }).catch((error: unknown) => {
        this.report("copy code block", error, { language: this.language || "text" });
        copy.textContent = "Copy failed";
      });
    });
    actions.append(edit, copy);
    bar.append(language, actions);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    appendHighlighted(this.code, this.language, code);
    pre.append(code);
    frame.append(bar, pre);
    return frame;
  }
  ignoreEvent(): boolean { return false; }
}

class LinkWidget extends WidgetType {
  constructor(private readonly text: string, private readonly from: number) { super(); }
  eq(other: LinkWidget): boolean { return other.text === this.text && other.from === this.from; }
  toDOM(view: EditorView): HTMLElement {
    const link = document.createElement("span");
    link.className = "napplet-md-link";
    link.textContent = this.text;
    link.tabIndex = 0;
    link.setAttribute("role", "link");
    link.setAttribute("aria-label", `${this.text}; edit Markdown link`);
    const reveal = () => { view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true }); view.focus(); };
    link.addEventListener("click", reveal);
    link.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); reveal(); } });
    return link;
  }
  ignoreEvent(): boolean { return false; }
}

class ResourceImageWidget extends WidgetType {
  constructor(private readonly source: string, private readonly alt: string, private readonly cache: ResourcePreviewCache, private readonly report: ErrorReporter) { super(); }
  eq(other: ResourceImageWidget): boolean { return other.source === this.source && other.alt === this.alt; }
  toDOM(): HTMLElement {
    const frame = document.createElement("span");
    frame.className = "napplet-md-media";
    frame.dataset.state = "loading";
    frame.textContent = `Loading image: ${this.alt || "Attached image"}`;
    void this.cache.acquire(this.source).then((objectUrl) => {
      if (!frame.isConnected || !objectUrl) return;
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = this.alt || "Attached image";
      image.addEventListener("error", () => {
        this.report("decode Markdown image preview", new Error("Browser could not decode image bytes."), { scheme: this.source.split(":", 1)[0] ?? "unknown" });
        frame.dataset.state = "error";
        frame.textContent = `Image unavailable: ${this.alt || "Attached image"}`;
      }, { once: true });
      frame.replaceChildren(image);
      frame.dataset.state = "ready";
    }).catch((error: unknown) => {
      this.cache.release(this.source);
      this.report("load Markdown image preview", error, { scheme: this.source.split(":", 1)[0] ?? "unknown" });
      frame.dataset.state = "error";
      frame.textContent = `Image unavailable: ${this.alt || "Attached image"}`;
    });
    return frame;
  }
  destroy(): void { this.cache.release(this.source); }
  ignoreEvent(): boolean { return false; }
}

function buildImageDecorations(view: EditorView, cache: ResourcePreviewCache, report: ErrorReporter): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const source = view.state.doc.toString();
  const fences = fencedRanges(source);
  for (const match of source.matchAll(IMAGE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selectionTouches(view.state, from, to) || insideAny(from, to, fences)) continue;
    builder.add(from, to, Decoration.replace({ widget: new ResourceImageWidget(match[2]!, match[1] ?? "", cache, report) }));
  }
  return builder.finish();
}

export function resourceImagePreview(load: ResourceLoader, report: ErrorReporter) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    readonly cache = new ResourcePreviewCache(load);
    constructor(view: EditorView) { this.decorations = buildImageDecorations(view, this.cache, report); }
    update(update: ViewUpdate): void { if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = buildImageDecorations(update.view, this.cache, report); }
    destroy(): void { this.cache.destroy(); }
  }, { decorations: (value) => value.decorations });
}

function buildLinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const source = view.state.doc.toString();
  const fences = fencedRanges(source);
  for (const match of source.matchAll(LINK)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selectionTouches(view.state, from, to) || insideAny(from, to, fences)) continue;
    builder.add(from, to, Decoration.replace({ widget: new LinkWidget(match[1] ?? "link", from) }));
  }
  return builder.finish();
}

export function nonNavigatingLinkPreview() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildLinkDecorations(view); }
    update(update: ViewUpdate): void { if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = buildLinkDecorations(update.view); }
  }, { decorations: (value) => value.decorations });
}

function buildCodeDecorations(state: EditorState, report: ErrorReporter): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const match of state.doc.toString().matchAll(CODE_FENCE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selectionTouches(state, from, to)) continue;
    builder.add(from, to, Decoration.replace({ widget: new CodeFenceWidget(match[2] ?? "", (match[1] ?? "").trim(), from, report), block: true }));
  }
  return builder.finish();
}

export function codeFencePreview(report: ErrorReporter) {
  return StateField.define<DecorationSet>({
    create: (state) => buildCodeDecorations(state, report),
    update: (decorations, transaction) => transaction.docChanged || transaction.selection ? buildCodeDecorations(transaction.state, report) : decorations,
    provide: (field) => EditorView.decorations.from(field)
  });
}
