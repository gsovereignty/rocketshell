import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { applyMarkdownCommand } from "./commands";

const apply = (doc: string, from: number, to: number, command: Parameters<typeof applyMarkdownCommand>[1]) => {
  const state = EditorState.create({ doc, selection: { anchor: from, head: to } });
  return state.update(applyMarkdownCommand(state, command)).state.doc.toString();
};

describe("Markdown commands", () => {
  it("wraps selected text", () => expect(apply("make this clear", 5, 9, "bold")).toBe("make **this** clear"));
  it("prefixes every selected list line", () => expect(apply("one\ntwo", 0, 7, "numbered-list")).toBe("1. one\n2. two"));
  it("inserts editable table source", () => expect(apply("", 0, 0, "table")).toContain("| Column 1 | Column 2 |"));
  it("inserts useful placeholders", () => expect(apply("", 0, 0, "link")).toBe("[link text](https://)"));
});
