import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import { Table } from "@lezer/markdown";
import { editorTheme, markdownStylePlugin } from "codemirror-live-markdown";
import { applyMarkdownCommand, markdownCommandSpecs, type MarkdownCommandName } from "./commands";

export type ErrorReporter = (operation: string, error: unknown, details?: Readonly<Record<string, string>>) => void;

export interface ProblemMarkdownEditorOptions {
  parent: HTMLElement;
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onError?: ErrorReporter;
  onAddMedia?: () => void;
}

export interface ProblemMarkdownEditor {
  getValue(): string;
  setValue(value: string): void;
  insertMarkdown(markdown: string): void;
  focus(): void;
  setDisabled(disabled: boolean): void;
  isDirtyComparedWith(value: string): boolean;
  destroy(): void;
}

export interface PlainMarkdownEditorFallbackOptions {
  parent: HTMLElement;
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  placeholder?: string;
  onChange?: (value: string) => void;
}

const fallbackReporter: ErrorReporter = (operation, error, details) => console.error(`Markdown editor failed to ${operation}`, { ...details, error });

function insertWithParagraphSpacing(state: EditorState, value: string) {
  const range = state.selection.main;
  const before = state.sliceDoc(0, range.from);
  const after = state.sliceDoc(range.to);
  const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
  const insert = `${prefix}${value}${suffix}`;
  return { changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + insert.length - suffix.length }, scrollIntoView: true };
}

export function createProblemMarkdownEditor(options: ProblemMarkdownEditorOptions): ProblemMarkdownEditor {
  const report = options.onError ?? fallbackReporter;
  const shell = document.createElement("div");
  shell.className = "napplet-md-editor";
  const toolbar = document.createElement("div");
  toolbar.className = "napplet-md-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Markdown formatting");
  const editorHost = document.createElement("div");
  editorHost.className = "napplet-md-surface";
  shell.append(toolbar, editorHost);
  options.parent.replaceChildren(shell);

  const readOnly = new Compartment();
  let destroyed = false;
  const runCommand = (view: EditorView, name: MarkdownCommandName) => {
    if (view.state.readOnly) return false;
    try { view.dispatch(applyMarkdownCommand(view.state, name)); view.focus(); return true; }
    catch (error) { report(`apply ${name} formatting`, error); return false; }
  };
  const extensions = [
    markdown({ extensions: [Table] }), history(),
    Prec.high(keymap.of([
      { key: "Mod-b", run: (view) => runCommand(view, "bold") },
      { key: "Mod-i", run: (view) => runCommand(view, "italic") },
      ...defaultKeymap, ...historyKeymap, indentWithTab
    ])),
    // Source-visible mode deliberately omits every replacement/collapse plugin.
    // Markdown markers remain visible on active and inactive lines alike.
    markdownStylePlugin, editorTheme,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": options.ariaLabel, "aria-multiline": "true" }),
    EditorView.updateListener.of((update) => { if (update.docChanged) options.onChange?.(update.state.doc.toString()); }),
    readOnly.of(EditorState.readOnly.of(Boolean(options.disabled)))
  ];
  if (options.placeholder) extensions.push(placeholderExtension(options.placeholder));

  const view = new EditorView({ state: EditorState.create({ doc: options.value, extensions }), parent: editorHost });

  const run = (name: MarkdownCommandName) => {
    runCommand(view, name);
  };
  for (const command of markdownCommandSpecs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "napplet-md-tool";
    button.dataset.command = command.name;
    button.disabled = Boolean(options.disabled);
    button.setAttribute("aria-label", command.label);
    if (command.shortcut) button.setAttribute("aria-keyshortcuts", command.shortcut.replace("Ctrl", "Control"));
    button.title = command.shortcut ? `${command.title} (${command.shortcut})` : command.title;
    button.innerHTML = command.icon;
    button.addEventListener("click", () => run(command.name));
    toolbar.append(button);
  }
  if (options.onAddMedia) {
    const separator = document.createElement("span");
    separator.className = "napplet-md-separator";
    separator.setAttribute("aria-hidden", "true");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "napplet-md-tool";
    button.dataset.command = "media";
    button.disabled = Boolean(options.disabled);
    button.setAttribute("aria-label", "Add image or video");
    button.title = "Add image or video";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 18 5-5 3 3 3-4 5 6"/></svg>';
    button.addEventListener("click", options.onAddMedia);
    toolbar.append(separator, button);
  }

  const setDisabled = (disabled: boolean) => {
    view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(disabled)) });
    toolbar.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = disabled; });
    shell.dataset.disabled = String(disabled);
  };
  setDisabled(Boolean(options.disabled));

  return {
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      if (destroyed || value === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    insertMarkdown(value) {
      if (destroyed || view.state.readOnly) return;
      view.dispatch(insertWithParagraphSpacing(view.state, value));
      view.focus();
    },
    focus: () => view.focus(),
    setDisabled,
    isDirtyComparedWith: (value) => view.state.doc.toString() !== value,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      view.destroy();
      shell.remove();
    }
  };
}

export function createPlainMarkdownEditorFallback(options: PlainMarkdownEditorFallbackOptions): ProblemMarkdownEditor {
  const input = document.createElement("textarea");
  input.className = "napplet-md-fallback";
  input.rows = 12;
  input.value = options.value;
  input.disabled = Boolean(options.disabled);
  input.placeholder = options.placeholder ?? "";
  input.setAttribute("aria-label", options.ariaLabel);
  options.parent.replaceChildren(input);
  let destroyed = false;
  const changed = () => options.onChange?.(input.value);
  input.addEventListener("input", changed);
  return {
    getValue: () => input.value,
    setValue(value) { input.value = value; changed(); },
    insertMarkdown(value) {
      if (input.disabled || destroyed) return;
      const before = input.value.slice(0, input.selectionStart);
      const after = input.value.slice(input.selectionEnd);
      const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
      const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
      input.setRangeText(`${prefix}${value}${suffix}`, input.selectionStart, input.selectionEnd, "end");
      changed();
    },
    focus: () => input.focus(),
    setDisabled: (disabled) => { input.disabled = disabled; },
    isDirtyComparedWith: (value) => input.value !== value,
    destroy() { if (destroyed) return; destroyed = true; input.removeEventListener("input", changed); input.remove(); }
  };
}
