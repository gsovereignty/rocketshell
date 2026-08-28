import type { ManagedNappletWindow } from "@platform/napplet-gateway";
import type { WidgetGridController } from "./widget-layout.js";

interface OpenWindowLookup {
  findByDTag(dTag: string): ManagedNappletWindow | undefined;
  show(windowId: string): void;
}

export const activateOpenWindow = (
  windows: OpenWindowLookup,
  grid: Pick<WidgetGridController, "reveal"> | null,
  dTag: string
): ManagedNappletWindow | undefined => {
  const existing = windows.findByDTag(dTag);
  if (!existing) return undefined;
  windows.show(existing.identity.windowId);
  grid?.reveal(existing.element);
  existing.iframe.focus();
  return existing;
};
