import { gsap } from "gsap";

export type GridProfileName = "mobile" | "tablet" | "laptop" | "wide";

export interface GridProfile {
  readonly name: GridProfileName;
  readonly columns: 1 | 2 | 4 | 6;
}

export interface WidgetRect {
  readonly column: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

const MOBILE: GridProfile = { name: "mobile", columns: 1 };
const TABLET: GridProfile = { name: "tablet", columns: 2 };
const LAPTOP: GridProfile = { name: "laptop", columns: 4 };
const WIDE: GridProfile = { name: "wide", columns: 6 };

export const profileForWidth = (width: number): GridProfile => {
  if (width < 600) return MOBILE;
  if (width < 900) return TABLET;
  if (width < 1400) return LAPTOP;
  return WIDE;
};

export const defaultWidgetRects = (count: number, columns: number): readonly WidgetRect[] => {
  if (count <= 0) return [];
  if (columns === 1) {
    return Array.from({ length: count }, (_, row) => ({ column: 0, row, width: 1, height: 1 }));
  }
  if (count === 1) return [{ column: 0, row: 0, width: columns, height: 2 }];
  const half = Math.floor(columns / 2);
  if (count === 2) {
    return [
      { column: 0, row: 0, width: half, height: 2 },
      { column: half, row: 0, width: columns - half, height: 2 }
    ];
  }
  return Array.from({ length: count }, (_, index) => ({
    column: index % 2 === 0 ? 0 : half,
    row: Math.floor(index / 2),
    width: index % 2 === 0 ? half : columns - half,
    height: 1
  }));
};

export const rectsOverlap = (a: WidgetRect, b: WidgetRect): boolean =>
  a.column < b.column + b.width &&
  a.column + a.width > b.column &&
  a.row < b.row + b.height &&
  a.row + a.height > b.row;

export const canPlaceRect = (
  candidate: WidgetRect,
  columns: number,
  occupied: readonly WidgetRect[]
): boolean => candidate.column >= 0 && candidate.row >= 0 && candidate.width >= 1 && candidate.height >= 1 &&
  candidate.column + candidate.width <= columns && !occupied.some((rect) => rectsOverlap(candidate, rect));

type ResizeEdge = "inline" | "block" | "both";

interface DragState {
  readonly element: HTMLElement;
  readonly edge: ResizeEdge;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startRect: WidgetRect;
  readonly startRects: ReadonlyMap<HTMLElement, WidgetRect>;
}

const widgetElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("napplet-window"));

const applyRect = (element: HTMLElement, rect: WidgetRect): void => {
  element.style.gridColumn = `${rect.column + 1} / span ${rect.width}`;
  element.style.gridRow = `${rect.row + 1} / span ${rect.height}`;
};

const makeHandle = (edge: ResizeEdge, title: string): HTMLButtonElement => {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = `napplet-resize-handle napplet-resize-${edge}`;
  handle.dataset.resizeEdge = edge;
  handle.setAttribute("aria-label", title);
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", edge === "block" ? "horizontal" : "vertical");
  return handle;
};

export interface WidgetGridController {
  destroy(): void;
  reset(): void;
}

export const createWidgetGrid = (
  container: HTMLElement,
  reducedMotion: MediaQueryList = window.matchMedia("(prefers-reduced-motion: reduce)")
): WidgetGridController => {
  let profile = profileForWidth(container.getBoundingClientRect().width);
  const rects = new Map<HTMLElement, WidgetRect>();
  let drag: DragState | null = null;

  const occupiedExcept = (element: HTMLElement): WidgetRect[] =>
    [...rects].filter(([candidate]) => candidate !== element).map(([, rect]) => rect);

  const updateHandleValues = (element: HTMLElement, rect: WidgetRect): void => {
    const inline = element.querySelector<HTMLElement>(".napplet-resize-inline");
    const block = element.querySelector<HTMLElement>(".napplet-resize-block");
    const both = element.querySelector<HTMLElement>(".napplet-resize-both");
    for (const handle of [inline, both]) {
      handle?.setAttribute("aria-valuemin", "1");
      handle?.setAttribute("aria-valuemax", String(profile.columns - rect.column));
      handle?.setAttribute("aria-valuenow", String(rect.width));
    }
    block?.setAttribute("aria-valuemin", "1");
    block?.setAttribute("aria-valuemax", "12");
    block?.setAttribute("aria-valuenow", String(rect.height));
  };

  const commitRects = (updates: ReadonlyMap<HTMLElement, WidgetRect>): boolean => {
    const next = new Map(rects);
    for (const [element, rect] of updates) next.set(element, rect);
    const entries = [...next];
    const valid = entries.every(([element, rect], index) =>
      canPlaceRect(rect, profile.columns, entries.filter(([candidate], otherIndex) => candidate !== element && otherIndex !== index).map(([, other]) => other))
    );
    if (!valid) return false;
    for (const [element, rect] of updates) {
      rects.set(element, rect);
      applyRect(element, rect);
      updateHandleValues(element, rect);
    }
    return true;
  };

  const setRect = (element: HTMLElement, rect: WidgetRect): boolean =>
    commitRects(new Map([[element, rect]]));

  const resizeFrom = (
    element: HTMLElement,
    start: WidgetRect,
    widthDelta: number,
    heightDelta: number,
    baseRects: ReadonlyMap<HTMLElement, WidgetRect> = rects
  ): void => {
    const updates = new Map<HTMLElement, WidgetRect>();
    const width = Math.max(1, Math.min(profile.columns - start.column, start.width + widthDelta));
    const height = Math.max(1, start.height + heightDelta);
    const appliedWidthDelta = width - start.width;
    const appliedHeightDelta = height - start.height;
    updates.set(element, { ...start, width, height });

    if (appliedWidthDelta !== 0) {
      const boundary = start.column + start.width;
      const neighbor = [...baseRects].find(([candidate, rect]) => candidate !== element && rect.column === boundary &&
        rect.row < start.row + start.height && rect.row + rect.height > start.row);
      if (neighbor) {
        const [candidate, rect] = neighbor;
        updates.set(candidate, { ...rect, column: rect.column + appliedWidthDelta, width: rect.width - appliedWidthDelta });
      }
    }
    if (appliedHeightDelta !== 0) {
      const boundary = start.row + start.height;
      const neighbor = [...baseRects].find(([candidate, rect]) => candidate !== element && rect.row === boundary &&
        rect.column < start.column + start.width && rect.column + rect.width > start.column);
      if (neighbor) {
        const [candidate, rect] = neighbor;
        updates.set(candidate, { ...rect, row: rect.row + appliedHeightDelta, height: rect.height - appliedHeightDelta });
      }
    }
    commitRects(updates);
  };

  const animateLayout = (elements: readonly HTMLElement[]): void => {
    if (reducedMotion.matches) return;
    gsap.fromTo(elements, { autoAlpha: 0, scale: .985, filter: "blur(3px)" }, {
      autoAlpha: 1,
      scale: 1,
      filter: "blur(0px)",
      duration: .28,
      ease: "power4.out",
      clearProps: "opacity,visibility,transform,filter"
    });
  };

  const reset = (animate = true): void => {
    const elements = widgetElements(container);
    rects.clear();
    defaultWidgetRects(elements.length, profile.columns).forEach((rect, index) => {
      const element = elements[index];
      if (element) setRect(element, rect);
    });
    if (animate) animateLayout(elements);
  };

  const decorate = (element: HTMLElement): void => {
    if (element.dataset.widgetResizable === "true") return;
    element.dataset.widgetResizable = "true";
    element.append(
      makeHandle("inline", "Resize window width"),
      makeHandle("block", "Resize window height"),
      makeHandle("both", "Resize window width and height")
    );
  };

  const sync = (): void => {
    const elements = widgetElements(container);
    for (const element of elements) decorate(element);
    for (const element of [...rects.keys()]) if (!elements.includes(element)) rects.delete(element);
    reset(true);
  };

  const resizeBy = (element: HTMLElement, widthDelta: number, heightDelta: number): void => {
    const current = rects.get(element);
    if (!current) return;
    resizeFrom(element, current, widthDelta, heightDelta);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-resize-edge]") : null;
    const element = handle?.closest<HTMLElement>(".napplet-window");
    const startRect = element ? rects.get(element) : undefined;
    if (!handle || !element || !startRect || event.button !== 0) return;
    event.preventDefault();
    const edge = handle.dataset.resizeEdge as ResizeEdge;
    handle.setPointerCapture(event.pointerId);
    drag = { element, edge, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startRect, startRects: new Map(rects) };
    container.dataset.interacting = "true";
    element.dataset.resizing = "true";
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const containerRect = container.getBoundingClientRect();
    const styles = getComputedStyle(container);
    const gap = Number.parseFloat(styles.columnGap) || 0;
    const cellWidth = (containerRect.width - gap * (profile.columns - 1)) / profile.columns;
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 220;
    const widthDelta = drag.edge === "block" ? 0 : Math.round((event.clientX - drag.startX) / (cellWidth + gap));
    const heightDelta = drag.edge === "inline" ? 0 : Math.round((event.clientY - drag.startY) / (rowHeight + gap));
    resizeFrom(drag.element, drag.startRect, widthDelta, heightDelta, drag.startRects);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    delete drag.element.dataset.resizing;
    delete container.dataset.interacting;
    drag = null;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-resize-edge]") : null;
    const element = handle?.closest<HTMLElement>(".napplet-window");
    if (!handle || !element) return;
    const edge = handle.dataset.resizeEdge as ResizeEdge;
    if (event.key === "Home") {
      event.preventDefault();
      reset(true);
      return;
    }
    const delta = event.shiftKey ? 2 : 1;
    const widthDelta = edge === "block" ? 0 : event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0;
    const heightDelta = edge === "inline" ? 0 : event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0;
    if (widthDelta === 0 && heightDelta === 0) return;
    event.preventDefault();
    resizeBy(element, widthDelta, heightDelta);
  };

  const mutationObserver = new MutationObserver(sync);
  mutationObserver.observe(container, { childList: true });
  const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const next = profileForWidth(entry.contentRect.width);
    if (next.name === profile.name) return;
    profile = next;
    container.dataset.gridProfile = profile.name;
    container.style.setProperty("--widget-columns", String(profile.columns));
    reset(true);
  });
  resizeObserver.observe(container);
  container.dataset.gridProfile = profile.name;
  container.style.setProperty("--widget-columns", String(profile.columns));
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", endDrag);
  container.addEventListener("pointercancel", endDrag);
  container.addEventListener("keydown", onKeyDown);
  sync();

  return {
    reset: () => reset(true),
    destroy: () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", endDrag);
      container.removeEventListener("pointercancel", endDrag);
      container.removeEventListener("keydown", onKeyDown);
      rects.clear();
    }
  };
};
