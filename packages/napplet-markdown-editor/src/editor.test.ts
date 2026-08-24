// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProblemMarkdownEditor } from "./editor";

afterEach(() => { document.body.replaceChildren(); });

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
});
