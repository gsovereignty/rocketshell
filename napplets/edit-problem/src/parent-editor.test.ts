// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { bindParentEditor, parentCoordinatesFromEditor, renderParentRows } from "./parent-editor";

const coordinate = (owner: string, id: string) => `31971:${owner.repeat(64)}:${id.repeat(64)}`;

const mount = (parents: string[] = []) => {
  const host = document.createElement("div");
  host.innerHTML = `<div id="parent-list">${renderParentRows(parents, true)}</div><input id="parent-coordinate"><button id="add-parent" type="button">Add parent</button>`;
  const onStatus = vi.fn();
  bindParentEditor(true, onStatus, host);
  return { host, input: host.querySelector<HTMLInputElement>("#parent-coordinate")!, onStatus };
};

describe("direct parent editor", () => {
  it("adds with pointer and removes with pointer", () => {
    const { host, input } = mount();
    input.value = coordinate("a", "b");
    host.querySelector<HTMLButtonElement>("#add-parent")!.click();
    expect(parentCoordinatesFromEditor(host)).toEqual([coordinate("a", "b")]);
    host.querySelector<HTMLButtonElement>(".remove-parent")!.click();
    expect(parentCoordinatesFromEditor(host)).toEqual([]);
  });

  it("adds on Enter without form submission", () => {
    const { host, input } = mount();
    input.value = coordinate("c", "d");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(parentCoordinatesFromEditor(host)).toEqual([coordinate("c", "d")]);
  });

  it("keeps invalid and duplicate coordinates out of draft", () => {
    const existing = coordinate("e", "f");
    const { host, input, onStatus } = mount([existing]);
    input.value = "bad";
    host.querySelector<HTMLButtonElement>("#add-parent")!.click();
    input.value = existing;
    host.querySelector<HTMLButtonElement>("#add-parent")!.click();
    expect(parentCoordinatesFromEditor(host)).toEqual([existing]);
    expect(onStatus).toHaveBeenCalledTimes(2);
  });
});
