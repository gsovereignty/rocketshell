import type { EditorState, TransactionSpec } from "@codemirror/state";

export type MarkdownCommandName =
  | "bold" | "italic" | "heading" | "bullet-list" | "numbered-list"
  | "blockquote" | "inline-code" | "code-block" | "link" | "table";

export interface MarkdownCommandSpec {
  name: MarkdownCommandName;
  label: string;
  title: string;
  shortcut?: string;
  icon: string;
}

const icon = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const markdownCommandSpecs: readonly MarkdownCommandSpec[] = [
  { name: "bold", label: "Bold", title: "Bold", shortcut: "Ctrl+B", icon: icon('<path d="M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7"/>') },
  { name: "italic", label: "Italic", title: "Italic", shortcut: "Ctrl+I", icon: icon('<path d="M10 4h7M7 20h7M14 4 10 20"/>') },
  { name: "heading", label: "Heading", title: "Heading", icon: icon('<path d="M5 5v14M15 5v14M5 12h10M19 8v11M17 10l2-2 2 2"/>') },
  { name: "bullet-list", label: "Bulleted list", title: "Bulleted list", icon: icon('<circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/><path d="M9 7h10M9 12h10M9 17h10"/>') },
  { name: "numbered-list", label: "Numbered list", title: "Numbered list", icon: icon('<path d="M4 6h2v4M4 10h3M4 14h3l-3 4h3M10 7h10M10 12h10M10 17h10"/>') },
  { name: "blockquote", label: "Quote", title: "Blockquote", icon: icon('<path d="M5 6h5v5H6v5h4M14 6h5v5h-4v5h4"/>') },
  { name: "inline-code", label: "Inline code", title: "Inline code", icon: icon('<path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>') },
  { name: "code-block", label: "Code block", title: "Code block", icon: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 9-2 3 2 3M12 15h4"/>') },
  { name: "link", label: "Link", title: "Link", icon: icon('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>') },
  { name: "table", label: "Table", title: "Table", icon: icon('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M9 5v14M15 5v14"/>') }
];

function wrap(state: EditorState, before: string, after: string, placeholder: string): TransactionSpec {
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to) || placeholder;
  const insert = `${before}${selected}${after}`;
  const from = range.from + before.length;
  return { changes: { from: range.from, to: range.to, insert }, selection: { anchor: from, head: from + selected.length }, scrollIntoView: true };
}

function prefixLines(state: EditorState, prefix: (index: number) => string): TransactionSpec {
  const range = state.selection.main;
  const start = state.doc.lineAt(range.from).from;
  const end = state.doc.lineAt(range.to).to;
  const lines = state.sliceDoc(start, end).split("\n");
  const insert = lines.map((line, index) => `${prefix(index)}${line}`).join("\n");
  return { changes: { from: start, to: end, insert }, selection: { anchor: start, head: start + insert.length }, scrollIntoView: true };
}

export function applyMarkdownCommand(state: EditorState, name: MarkdownCommandName): TransactionSpec {
  switch (name) {
    case "bold": return wrap(state, "**", "**", "bold text");
    case "italic": return wrap(state, "*", "*", "italic text");
    case "inline-code": return wrap(state, "`", "`", "code");
    case "link": return wrap(state, "[", "](https://)", "link text");
    case "heading": return prefixLines(state, () => "## ");
    case "bullet-list": return prefixLines(state, () => "- ");
    case "numbered-list": return prefixLines(state, (index) => `${index + 1}. `);
    case "blockquote": return prefixLines(state, () => "> ");
    case "code-block": return wrap(state, "```text\n", "\n```", "code");
    case "table": {
      const range = state.selection.main;
      const insert = "| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |";
      return { changes: { from: range.from, to: range.to, insert }, selection: { anchor: range.from + 2, head: range.from + 10 }, scrollIntoView: true };
    }
  }
}
