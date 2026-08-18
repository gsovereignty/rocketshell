import { createBrowserPlatform, type BrowserPlatform } from "./platform.js";

export async function bootstrap(): Promise<BrowserPlatform> {
  const container = document.querySelector<HTMLElement>("#windows");
  if (!container) throw new Error("Napplet window container missing");
  return createBrowserPlatform(container);
}
