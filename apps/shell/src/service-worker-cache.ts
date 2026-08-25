export const SHELL_CACHE_PREFIX = "platform-shell-";

/* One cache per build. A new build id retires every earlier cache, so a rebuilt
   shell can never be served from a previous build's cache. */
export const shellCacheName = (buildId: string): string => `${SHELL_CACHE_PREFIX}${buildId}`;

export const isRetiredShellCache = (name: string, current: string): boolean =>
  name.startsWith(SHELL_CACHE_PREFIX) && name !== current;

export function isBuiltInNappletRequest(pathname: string, scopePath: string): boolean {
  const base = scopePath.endsWith("/") ? scopePath : `${scopePath}/`;
  return pathname === `${base}napplets.json` || pathname.startsWith(`${base}napplets/`);
}

export function isShellNavigationRequest(pathname: string, scopePath: string): boolean {
  const base = scopePath.endsWith("/") ? scopePath : `${scopePath}/`;
  return pathname === base || pathname === `${base}index.html`;
}
