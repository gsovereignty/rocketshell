// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlainMarkdownEditorFallback, createProblemMarkdownEditor } from "./editor";

afterEach(() => { document.body.replaceChildren(); });
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({ left:0,right:0,top:0,bottom:0,width:0,height:0,x:0,y:0,toJSON:() => ({}) });
});

const visibleSource = (parent: HTMLElement) =>
  [...parent.querySelectorAll<HTMLElement>(".cm-line")].map((line) => line.textContent ?? "").join("\n");

describe("problem Markdown editor", () => {
  it("keeps plain Markdown canonical across updates and inserts", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onChange = vi.fn();
    const editor = createProblemMarkdownEditor({ parent, value: "# Start", ariaLabel: "Problem description", onChange });
    expect(editor.getValue()).toBe("# Start");
    editor.setValue("Changed");
    editor.insertMarkdown("**detail**");
    expect(editor.getValue()).toContain("**detail**");
    expect(onChange).toHaveBeenCalled();
    editor.destroy();
    expect(parent.childElementCount).toBe(0);
  });

  it("keeps Markdown syntax visible when editor loses focus", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const source = "# Heading\n\n**bold** and *italic*\n\n> quote\n\n- item";
    const editor = createProblemMarkdownEditor({ parent, value: source, ariaLabel: "Problem description" });
    parent.querySelector<HTMLElement>(".cm-content")!.blur();
    expect(visibleSource(parent)).toBe(source);
    expect(parent.querySelector(".cm-header-1")).toBeTruthy();
    expect(parent.querySelector(".cm-strong")).toBeTruthy();
    expect(parent.querySelector(".cm-emphasis")).toBeTruthy();
    expect(parent.querySelector(".cm-table-widget, .napplet-md-code, .napplet-md-link, .napplet-md-media")).toBeNull();
    editor.destroy();
  });

  it("blocks formatting and insertion while read-only", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createProblemMarkdownEditor({ parent, value: "kept", disabled: true, ariaLabel: "Problem description" });
    editor.insertMarkdown("lost");
    expect(editor.getValue()).toBe("kept");
    expect([...parent.querySelectorAll<HTMLButtonElement>("button")].every((button) => button.disabled)).toBe(true);
    editor.destroy();
  });

  it("restores media action when read-only editor becomes writable", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onAddMedia = vi.fn();
    const editor = createProblemMarkdownEditor({ parent, value: "draft", disabled: true, ariaLabel: "Problem description", onAddMedia });
    const media = parent.querySelector<HTMLButtonElement>('[data-command="media"]')!;
    expect(media).toBeTruthy();
    expect(media.disabled).toBe(true);
    editor.setDisabled(false);
    expect(media.disabled).toBe(false);
    media.click();
    expect(onAddMedia).toHaveBeenCalledOnce();
    expect(editor.getValue()).toBe("draft");
    editor.setDisabled(true);
    expect(media.disabled).toBe(true);
    editor.destroy();
  });

  it("supports keyboard formatting and toolbar activation", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createProblemMarkdownEditor({ parent, value: "", ariaLabel: "Problem description" });
    const content = parent.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }));
    expect(editor.getValue()).toBe("**bold text**");
    parent.querySelector<HTMLButtonElement>('[data-command="strikethrough"]')!.click();
    expect(editor.getValue()).toBe("**~~bold text~~**");
    editor.destroy();
  });

  it("keeps complex Markdown constructs visible as source", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const source = 'x\n```javascript\nconst image = "![sample](https://example.test/a.png)";\n```\n\n[Docs](https://example.test)';
    const editor = createProblemMarkdownEditor({
      parent, value: source, ariaLabel: "Problem description"
    });
    expect(visibleSource(parent)).toBe(source);
    expect(parent.querySelector(".napplet-md-code, .napplet-md-link, .napplet-md-media")).toBeNull();
    editor.destroy();
  });

  it("fallback updates character count and supports insertion/reset", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onChange = vi.fn();
    const editor = createPlainMarkdownEditorFallback({ parent, value: "one", ariaLabel: "Problem description", onChange });
    editor.insertMarkdown("two");
    expect(editor.getValue()).toContain("two");
    editor.setValue("");
    expect(onChange).toHaveBeenLastCalledWith("");
    editor.destroy();
  });
});
