export function isBuiltInNappletRequest(pathname: string, scopePath: string): boolean {
  const base = scopePath.endsWith("/") ? scopePath : `${scopePath}/`;
  return pathname === `${base}napplets.json` || pathname.startsWith(`${base}napplets/`);
}
