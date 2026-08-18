import { createBrowserPlatform } from "./platform.js";

export interface PlatformHandle { close(): Promise<void> }

export async function bootstrap(): Promise<PlatformHandle> {
  const container = document.querySelector<HTMLElement>("#windows");
  if (!container) throw new Error("Napplet window container missing");
  return createBrowserPlatform(container);
}
