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

interface ResizeState {
  readonly element: HTMLElement;
  readonly edge: ResizeEdge;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startRect: WidgetRect;
  readonly startRects: ReadonlyMap<HTMLElement, WidgetRect>;
}

interface MoveState {
  readonly element: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly startRect: WidgetRect;
  readonly grabOffsetX: number;
  readonly grabOffsetY: number;
  candidate: WidgetRect;
  placement: RelocationResult;
}

export type RelocationResult =
  | { readonly kind: "move"; readonly updates: ReadonlyMap<number, WidgetRect> }
  | { readonly kind: "swap"; readonly updates: ReadonlyMap<number, WidgetRect> }
  | { readonly kind: "pack"; readonly updates: ReadonlyMap<number, WidgetRect> }
  | { readonly kind: "reject"; readonly updates: ReadonlyMap<number, WidgetRect> };

const firstAvailableRect = (
  widget: WidgetRect,
  columns: number,
  occupied: readonly WidgetRect[]
): WidgetRect | undefined => {
  if (widget.width > columns) return undefined;
  const lastOccupiedRow = occupied.reduce((last, rect) => Math.max(last, rect.row + rect.height), 0);
  for (let row = 0; row <= lastOccupiedRow; row += 1) {
    for (let column = 0; column <= columns - widget.width; column += 1) {
      const candidate = { ...widget, column, row };
      if (canPlaceRect(candidate, columns, occupied)) return candidate;
    }
  }
  return undefined;
};

export const resolveRelocation = (
  movingIndex: number,
  candidate: WidgetRect,
  rects: readonly WidgetRect[],
  columns: number
): RelocationResult => {
  const start = rects[movingIndex];
  if (!start || candidate.column < 0 || candidate.row < 0 || candidate.column + candidate.width > columns) {
    return { kind: "reject", updates: new Map() };
  }
  const collisions = rects
    .map((rect, index) => ({ rect, index }))
    .filter(({ rect, index }) => index !== movingIndex && rectsOverlap(candidate, rect));
  if (collisions.length === 0) return { kind: "move", updates: new Map([[movingIndex, candidate]]) };
  if (collisions.length === 1) {
    const collision = collisions[0]!;
    const sameSize = collision.rect.width === candidate.width && collision.rect.height === candidate.height;
    const exactTarget = collision.rect.column === candidate.column && collision.rect.row === candidate.row;
    if (sameSize && exactTarget) {
      return {
        kind: "swap",
        updates: new Map([[movingIndex, candidate], [collision.index, start]])
      };
    }
  }

  const displaced = new Set(collisions.map(({ index }) => index));
  const occupied = rects.filter((_rect, index) => index !== movingIndex && !displaced.has(index));
  occupied.push(candidate);
  const updates = new Map<number, WidgetRect>([[movingIndex, candidate]]);
  for (const collision of collisions) {
    const packed = firstAvailableRect(collision.rect, columns, occupied);
    if (!packed) return { kind: "reject", updates: new Map() };
    updates.set(collision.index, packed);
    occupied.push(packed);
  }
  return { kind: "pack", updates };
};

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
  let resize: ResizeState | null = null;
  let move: MoveState | null = null;
  let keyboardMove: { element: HTMLElement; startRect: WidgetRect; candidate: WidgetRect; placement: RelocationResult } | null = null;
  const preview = document.createElement("div");
  preview.className = "napplet-pack-preview-layer";
  preview.setAttribute("aria-hidden", "true");
  container.append(preview);

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

  const placementFor = (element: HTMLElement, candidate: WidgetRect): RelocationResult => {
    const entries = [...rects];
    const movingIndex = entries.findIndex(([candidateElement]) => candidateElement === element);
    return resolveRelocation(movingIndex, candidate, entries.map(([, rect]) => rect), profile.columns);
  };

  const previewCard = (element: HTMLElement, rect: WidgetRect, placement: RelocationResult["kind"]): HTMLElement => {
    const card = document.createElement("article");
    const toolbar = document.createElement("header");
    const title = document.createElement("span");
    const content = document.createElement("div");
    card.className = "napplet-pack-preview";
    card.dataset.placement = placement;
    toolbar.className = "napplet-pack-preview-toolbar";
    title.className = "napplet-pack-preview-title";
    title.textContent = element.querySelector<HTMLElement>(".napplet-window-title")?.textContent ?? "Napplet";
    content.className = "napplet-pack-preview-content";
    toolbar.append(title);
    card.append(toolbar, content);
    applyRect(card, rect);
    return card;
  };

  const showPreview = (element: HTMLElement, candidate: WidgetRect, placement: RelocationResult): void => {
    const entries = [...rects];
    const cards: HTMLElement[] = [];
    if (placement.kind === "reject") {
      cards.push(previewCard(element, candidate, placement.kind));
    } else {
      for (const [index, rect] of placement.updates) {
        const target = entries[index]?.[0];
        if (target) cards.push(previewCard(target, rect, placement.kind));
      }
    }
    preview.replaceChildren(...cards);
  };

  const hidePreview = (): void => {
    preview.replaceChildren();
  };

  const animateCommittedPlacement = (
    updates: ReadonlyMap<HTMLElement, WidgetRect>,
    before: ReadonlyMap<HTMLElement, DOMRect>
  ): void => {
    if (reducedMotion.matches) return;
    for (const element of updates.keys()) {
      const oldBounds = before.get(element);
      if (!oldBounds) continue;
      const nextBounds = element.getBoundingClientRect();
      gsap.fromTo(element, {
        x: oldBounds.left - nextBounds.left,
        y: oldBounds.top - nextBounds.top,
        scale: element === move?.element ? 1.015 : 1
      }, {
        x: 0,
        y: 0,
        scale: 1,
        duration: .24,
        ease: "power4.out",
        clearProps: "transform"
      });
    }
  };

  const commitPlacement = (element: HTMLElement, placement: RelocationResult): boolean => {
    if (placement.kind === "reject") return false;
    const entries = [...rects];
    const updates = new Map<HTMLElement, WidgetRect>();
    for (const [index, rect] of placement.updates) {
      const target = entries[index]?.[0];
      if (target) updates.set(target, rect);
    }
    const before = new Map([...updates.keys()].map((target) => [target, target.getBoundingClientRect()]));
    gsap.set(element, { clearProps: "transform" });
    if (!commitRects(updates)) return false;
    animateCommittedPlacement(updates, before);
    return true;
  };

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
    const toolbar = element.querySelector<HTMLElement>(".napplet-window-toolbar");
    if (toolbar) {
      toolbar.tabIndex = 0;
      toolbar.dataset.widgetDragHandle = "true";
      toolbar.setAttribute("aria-label", "Move window. Press Space, then use arrow keys.");
    }
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
    if (handle && element && startRect && event.button === 0) {
      event.preventDefault();
      const edge = handle.dataset.resizeEdge as ResizeEdge;
      handle.setPointerCapture(event.pointerId);
      resize = { element, edge, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startRect, startRects: new Map(rects) };
      container.dataset.interacting = "resize";
      element.dataset.resizing = "true";
      return;
    }
    const toolbar = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-widget-drag-handle]") : null;
    const movingElement = toolbar?.closest<HTMLElement>(".napplet-window");
    const movingRect = movingElement ? rects.get(movingElement) : undefined;
    if (!toolbar || !movingElement || !movingRect || event.button !== 0 || event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return;
    event.preventDefault();
    toolbar.setPointerCapture(event.pointerId);
    const bounds = movingElement.getBoundingClientRect();
    const placement = placementFor(movingElement, movingRect);
    move = {
      element: movingElement,
      toolbar,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: movingRect,
      grabOffsetX: event.clientX - bounds.left,
      grabOffsetY: event.clientY - bounds.top,
      candidate: movingRect,
      placement
    };
    keyboardMove = null;
    container.dataset.interacting = "move";
    movingElement.dataset.dragging = "true";
    toolbar.setAttribute("aria-grabbed", "true");
    showPreview(movingElement, movingRect, placement);
    if (!reducedMotion.matches) gsap.to(movingElement, { scale: 1.015, duration: .14, ease: "power3.out" });
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (resize && event.pointerId === resize.pointerId) {
      const containerRect = container.getBoundingClientRect();
      const styles = getComputedStyle(container);
      const gap = Number.parseFloat(styles.columnGap) || 0;
      const cellWidth = (containerRect.width - gap * (profile.columns - 1)) / profile.columns;
      const rowHeight = Number.parseFloat(styles.gridAutoRows) || 220;
      const widthDelta = resize.edge === "block" ? 0 : Math.round((event.clientX - resize.startX) / (cellWidth + gap));
      const heightDelta = resize.edge === "inline" ? 0 : Math.round((event.clientY - resize.startY) / (rowHeight + gap));
      resizeFrom(resize.element, resize.startRect, widthDelta, heightDelta, resize.startRects);
      return;
    }
    if (!move || event.pointerId !== move.pointerId) return;
    const containerRect = container.getBoundingClientRect();
    const styles = getComputedStyle(container);
    const gap = Number.parseFloat(styles.columnGap) || 0;
    const cellWidth = (containerRect.width - gap * (profile.columns - 1)) / profile.columns;
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 220;
    const column = Math.max(0, Math.min(profile.columns - move.startRect.width,
      Math.round((event.clientX - containerRect.left - move.grabOffsetX) / (cellWidth + gap))));
    const row = Math.max(0, Math.round((event.clientY - containerRect.top - move.grabOffsetY) / (rowHeight + gap)));
    move.candidate = { ...move.startRect, column, row };
    move.placement = placementFor(move.element, move.candidate);
    showPreview(move.element, move.candidate, move.placement);
    gsap.set(move.element, { x: event.clientX - move.startX, y: event.clientY - move.startY });
  };

  const endDrag = (event: PointerEvent): void => {
    if (resize && event.pointerId === resize.pointerId) {
      const resizeHandle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-resize-edge]") : null;
      if (resizeHandle?.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
      delete resize.element.dataset.resizing;
      delete container.dataset.interacting;
      resize = null;
      return;
    }
    if (!move || event.pointerId !== move.pointerId) return;
    const active = move;
    if (active.toolbar.hasPointerCapture(event.pointerId)) active.toolbar.releasePointerCapture(event.pointerId);
    const accepted = event.type !== "pointercancel" && commitPlacement(active.element, active.placement);
    if (!accepted) {
      gsap.to(active.element, {
        x: 0,
        y: 0,
        scale: 1,
        duration: reducedMotion.matches ? 0 : .2,
        ease: "power4.out",
        clearProps: "transform"
      });
    }
    delete active.element.dataset.dragging;
    active.toolbar.removeAttribute("aria-grabbed");
    delete container.dataset.interacting;
    hidePreview();
    move = null;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-resize-edge]") : null;
    const element = handle?.closest<HTMLElement>(".napplet-window");
    if (!handle || !element) {
      const toolbar = event.target instanceof HTMLElement && event.target.matches("[data-widget-drag-handle]") ? event.target : null;
      const movingElement = toolbar?.closest<HTMLElement>(".napplet-window");
      const current = movingElement ? rects.get(movingElement) : undefined;
      if (!toolbar || !movingElement || !current) return;
      if (!keyboardMove && (event.key === " " || event.key === "Spacebar")) {
        event.preventDefault();
        keyboardMove = { element: movingElement, startRect: current, candidate: current, placement: placementFor(movingElement, current) };
        container.dataset.interacting = "move";
        movingElement.dataset.dragging = "true";
        toolbar.setAttribute("aria-grabbed", "true");
        showPreview(movingElement, current, keyboardMove.placement);
        return;
      }
      if (!keyboardMove || keyboardMove.element !== movingElement) return;
      if (event.key === "Escape") {
        event.preventDefault();
        delete movingElement.dataset.dragging;
        toolbar.removeAttribute("aria-grabbed");
        delete container.dataset.interacting;
        hidePreview();
        keyboardMove = null;
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        commitPlacement(movingElement, keyboardMove.placement);
        delete movingElement.dataset.dragging;
        toolbar.removeAttribute("aria-grabbed");
        delete container.dataset.interacting;
        hidePreview();
        keyboardMove = null;
        return;
      }
      const columnDelta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const rowDelta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (columnDelta === 0 && rowDelta === 0) return;
      event.preventDefault();
      const candidate = {
        ...keyboardMove.candidate,
        column: Math.max(0, Math.min(profile.columns - current.width, keyboardMove.candidate.column + columnDelta)),
        row: Math.max(0, keyboardMove.candidate.row + rowDelta)
      };
      keyboardMove.candidate = candidate;
      keyboardMove.placement = placementFor(movingElement, candidate);
      showPreview(movingElement, candidate, keyboardMove.placement);
      return;
    }
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
      preview.remove();
      rects.clear();
    }
  };
};
