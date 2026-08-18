import { artifactResponse } from "./response-builder.js";
import type { PackageStore } from "./types.js";
import { parseVirtualNappletUrl } from "./virtual-url.js";

export async function routeNappletRequest(request: Request, scopePath: string, store: PackageStore): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  const location = parseVirtualNappletUrl(new URL(request.url), scopePath);
  if (!location) return undefined;
  const installation = await store.get(location.dTag, location.aggregateHash);
  const artifact = installation?.artifacts.find((item) => item.path === location.path);
  return artifact ? artifactResponse(artifact, installation?.namespacePrelude ?? "", new URL("./", request.url).href, installation?.artifacts) : new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
