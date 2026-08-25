import { SHELL_CACHE_PREFIX } from "./service-worker-cache.js";

export interface ShellWorkerRegistration {
  unregister(): Promise<boolean>;
}

export interface ShellWorkerContainer {
  getRegistration(clientUrl?: string): Promise<ShellWorkerRegistration | undefined>;
}

export interface ShellCacheStorage {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

export async function resetShellRuntime(
  workers: ShellWorkerContainer,
  cacheStorage: ShellCacheStorage,
  scopeUrl: string
): Promise<void> {
  const registration = await workers.getRegistration(scopeUrl);
  await registration?.unregister();
  const shellCaches = (await cacheStorage.keys()).filter((name) => name.startsWith(SHELL_CACHE_PREFIX));
  await Promise.all(shellCaches.map((name) => cacheStorage.delete(name)));
}

export function cacheBustedShellUrl(currentUrl: string, token: string): string {
  const url = new URL(currentUrl);
  url.searchParams.set("shell-reset", token);
  return url.href;
}
