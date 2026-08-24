// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlainMarkdownEditorFallback, createProblemMarkdownEditor } from "./editor";

afterEach(() => { document.body.replaceChildren(); });
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({ left:0,right:0,top:0,bottom:0,width:0,height:0,x:0,y:0,toJSON:() => ({}) });
});

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

  it("renders links without anchors and reveals source on click", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = createProblemMarkdownEditor({ parent, value: "x [Docs](https://example.test)", ariaLabel: "Problem description" });
    const link = parent.querySelector<HTMLElement>(".napplet-md-link")!;
    expect(link).toBeTruthy();
    expect(parent.querySelector("a")).toBeNull();
    link.click();
    expect(parent.querySelector(".napplet-md-link")).toBeNull();
    editor.destroy();
  });

  it("keeps images inside code fences as highlighted code", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const loadResource = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const editor = createProblemMarkdownEditor({
      parent, value: 'x\n```javascript\nconst image = "![sample](https://example.test/a.png)";\n```', ariaLabel: "Problem description", loadResource
    });
    expect(parent.querySelector(".napplet-md-code")).toBeTruthy();
    expect(parent.querySelector(".napplet-md-media")).toBeNull();
    expect(parent.querySelector(".tok-keyword")?.textContent).toBe("const");
    expect(loadResource).not.toHaveBeenCalled();
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
