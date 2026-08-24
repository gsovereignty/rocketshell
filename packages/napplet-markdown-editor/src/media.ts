import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export type ResourceLoader = (url: string, signal: AbortSignal) => Promise<Blob>;
export type ErrorReporter = (operation: string, error: unknown, details?: Readonly<Record<string, string>>) => void;

const IMAGE = /!\[([^\]]*)\]\((https:\/\/[^\s)]+|blossom:[^\s)]+|htree:[^\s)]+|nostr:[^\s)]+|data:[^\s)]+)\)/g;
const CODE_FENCE = /```([^\n`]*)\n([\s\S]*?)\n```/g;

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
    edit.addEventListener("click", () => {
      view.dispatch({ selection: { anchor: this.from + 3 + this.language.length + 1 }, scrollIntoView: true });
      view.focus();
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      if (!navigator.clipboard?.writeText) {
        const error = new Error("Clipboard API unavailable in this sandbox.");
        this.report("copy code block", error, { language: this.language || "text" });
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
    code.textContent = this.code;
    pre.append(code);
    frame.append(bar, pre);
    return frame;
  }
  ignoreEvent(): boolean { return false; }
}

class ResourceImageWidget extends WidgetType {
  constructor(private readonly source: string, private readonly alt: string, private readonly load: ResourceLoader, private readonly report: ErrorReporter) { super(); }
  eq(other: ResourceImageWidget): boolean { return other.source === this.source && other.alt === this.alt; }
  toDOM(): HTMLElement {
    const frame = document.createElement("span");
    frame.className = "napplet-md-media";
    frame.dataset.state = "loading";
    frame.textContent = `Loading image: ${this.alt || "Attached image"}`;
    const controller = new AbortController();
    let objectUrl = "";
    void this.load(this.source, controller.signal).then((blob) => {
      if (!blob.type.startsWith("image/")) throw new Error(`Unsupported preview type: ${blob.type || "unknown"}`);
      if (!frame.isConnected) return;
      objectUrl = URL.createObjectURL(blob);
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = this.alt || "Attached image";
      image.addEventListener("error", () => {
        this.report("decode Markdown image preview", new Error("Browser could not decode image bytes."), { scheme: this.source.split(":", 1)[0] ?? "unknown" });
        frame.dataset.state = "error";
        frame.textContent = `Image unavailable: ${this.alt || "Attached image"}`;
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      }, { once: true });
      frame.replaceChildren(image);
      frame.dataset.state = "ready";
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      this.report("load Markdown image preview", error, { scheme: this.source.split(":", 1)[0] ?? "unknown" });
      frame.dataset.state = "error";
      frame.textContent = `Image unavailable: ${this.alt || "Attached image"}`;
    });
    (frame as HTMLElement & { cleanup?: () => void }).cleanup = () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    return frame;
  }
  destroy(dom: HTMLElement): void { (dom as HTMLElement & { cleanup?: () => void }).cleanup?.(); }
  ignoreEvent(): boolean { return false; }
}

function buildDecorations(view: EditorView, load: ResourceLoader, report: ErrorReporter): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection.main;
  const source = view.state.doc.toString();
  for (const match of source.matchAll(IMAGE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selection.from <= to && selection.to >= from) continue;
    builder.add(from, to, Decoration.replace({ widget: new ResourceImageWidget(match[2]!, match[1] ?? "", load, report), block: true }));
  }
  return builder.finish();
}

export function resourceImagePreview(load: ResourceLoader, report: ErrorReporter) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildDecorations(view, load, report); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = buildDecorations(update.view, load, report);
    }
  }, { decorations: (value) => value.decorations });
}

function buildCodeDecorations(view: EditorView, report: ErrorReporter): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection.main;
  for (const match of view.state.doc.toString().matchAll(CODE_FENCE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selection.from <= to && selection.to >= from) continue;
    builder.add(from, to, Decoration.replace({ widget: new CodeFenceWidget(match[2] ?? "", (match[1] ?? "").trim(), from, report), block: true }));
  }
  return builder.finish();
}

export function codeFencePreview(report: ErrorReporter) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildCodeDecorations(view, report); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = buildCodeDecorations(update.view, report);
    }
  }, { decorations: (value) => value.decorations });
}
