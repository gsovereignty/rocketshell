import { gsap } from "gsap";
import type { NappletWindowManager } from "@platform/napplet-gateway";
import type { NappletConsoleStore, NappletLogLevel } from "./napplet-console-store.js";

interface ConsoleElements {
  readonly trigger: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly header: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly clear: HTMLButtonElement;
  readonly tabs: HTMLElement;
  readonly output: HTMLElement;
  readonly empty: HTMLElement;
}

const timeLabel = (timestamp: number): string => new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const createNappletConsoleView = (elements: ConsoleElements, windows: NappletWindowManager, store: NappletConsoleStore, reducedMotion: MediaQueryList): { close(): void } => {
  let activeWindowId: string | undefined;
  let open = false;
  let drag: { pointerId: number; startX: number; startY: number; left: number; top: number } | undefined;
  const seen = new Map<string, number>();

  const titleFor = (windowId: string): string => {
    const managed = windows.findByWindowId(windowId);
    return managed?.element.querySelector<HTMLElement>(".napplet-window-title")?.textContent?.trim() || managed?.identity.dTag || "Napplet";
  };

  const renderOutput = (): void => {
    const entries = activeWindowId ? store.list(activeWindowId) : [];
    const nearBottom = elements.output.scrollHeight - elements.output.scrollTop - elements.output.clientHeight < 48;
    elements.output.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div");
      const time = document.createElement("time");
      const level = document.createElement("span");
      const message = document.createElement("pre");
      row.className = "napplet-console-row";
      row.dataset.level = entry.level;
      time.dateTime = new Date(entry.timestamp).toISOString();
      time.textContent = timeLabel(entry.timestamp);
      level.className = "napplet-console-level";
      level.textContent = entry.level;
      message.textContent = entry.args.join(" ");
      row.append(time, level, message);
      elements.output.append(row);
    }
    elements.empty.hidden = entries.length > 0;
    if (activeWindowId && open) seen.set(activeWindowId, entries.at(-1)?.id ?? 0);
    if (nearBottom) elements.output.scrollTop = elements.output.scrollHeight;
  };

  const renderTabs = (): void => {
    const ids = [...windows.listWindowIds()];
    if (!activeWindowId || !ids.includes(activeWindowId)) activeWindowId = ids[0];
    elements.tabs.replaceChildren();
    const titleTotals = new Map<string, number>();
    for (const id of ids) titleTotals.set(titleFor(id), (titleTotals.get(titleFor(id)) ?? 0) + 1);
    const titleIndexes = new Map<string, number>();
    for (const id of ids) {
      const baseTitle = titleFor(id);
      const index = (titleIndexes.get(baseTitle) ?? 0) + 1;
      titleIndexes.set(baseTitle, index);
      const label = titleTotals.get(baseTitle)! > 1 ? `${baseTitle} ${index}` : baseTitle;
      const button = document.createElement("button");
      const count = document.createElement("span");
      const logs = store.list(id);
      const unread = logs.filter((entry) => entry.id > (seen.get(id) ?? 0)).length;
      const hasError = logs.some((entry) => entry.level === "error" && entry.id > (seen.get(id) ?? 0));
      button.type = "button";
      button.role = "tab";
      button.className = "napplet-console-tab";
      button.setAttribute("aria-selected", String(id === activeWindowId));
      button.textContent = label;
      button.title = label;
      if (unread > 0 && (id !== activeWindowId || !open)) {
        count.textContent = String(Math.min(unread, 99));
        count.className = "napplet-console-unread";
        if (hasError) count.dataset.level = "error";
        button.append(count);
      }
      button.addEventListener("click", () => {
        activeWindowId = id;
        seen.set(id, logs.at(-1)?.id ?? 0);
        renderTabs(); renderOutput();
        if (!reducedMotion.matches) gsap.fromTo(elements.output, { autoAlpha: .35, x: 8 }, { autoAlpha: 1, x: 0, duration: .2, ease: "power3.out", clearProps: "opacity,visibility,transform" });
      });
      elements.tabs.append(button);
    }
    elements.tabs.hidden = ids.length === 0;
    elements.clear.disabled = !activeWindowId || store.list(activeWindowId).length === 0;
  };

  const render = (): void => { renderTabs(); renderOutput(); };
  const hide = (): void => {
    if (!open) return;
    open = false;
    elements.trigger.setAttribute("aria-expanded", "false");
    const finish = (): void => { elements.panel.hidden = true; gsap.set(elements.panel, { clearProps: "opacity,visibility,scale" }); };
    if (reducedMotion.matches) finish();
    else gsap.to(elements.panel, { autoAlpha: 0, scale: .97, duration: .14, ease: "power2.in", onComplete: finish });
  };
  const show = (): void => {
    if (open) return;
    open = true;
    elements.panel.hidden = false;
    elements.trigger.setAttribute("aria-expanded", "true");
    render();
    if (!reducedMotion.matches) gsap.fromTo(elements.panel, { autoAlpha: 0, scale: .96, y: 10 }, { autoAlpha: 1, scale: 1, y: 0, duration: .25, ease: "power4.out", clearProps: "opacity,visibility,scale" });
  };

  elements.trigger.addEventListener("click", () => open ? hide() : show());
  elements.close.addEventListener("click", hide);
  elements.clear.addEventListener("click", () => { if (activeWindowId) store.clear(activeWindowId); });
  elements.header.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    const bounds = elements.panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: bounds.left, top: bounds.top };
    elements.header.setPointerCapture(event.pointerId);
    elements.panel.dataset.dragging = "true";
  });
  elements.header.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.max(8, Math.min(innerWidth - elements.panel.offsetWidth - 8, drag.left + event.clientX - drag.startX));
    const top = Math.max(8, Math.min(innerHeight - elements.panel.offsetHeight - 8, drag.top + event.clientY - drag.startY));
    Object.assign(elements.panel.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
  });
  elements.header.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined; delete elements.panel.dataset.dragging;
    elements.header.releasePointerCapture(event.pointerId);
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && open) hide(); });

  const unsubscribeStore = store.subscribe((windowId) => {
    if (windowId === activeWindowId) renderOutput();
    renderTabs();
  });
  const unsubscribeWindows = windows.onWindowsChanged(render);
  render();
  return { close() { unsubscribeStore(); unsubscribeWindows(); hide(); } };
};
