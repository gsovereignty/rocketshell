import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

export interface BuiltInNappletMetadata {
  readonly dTag: string;
  readonly title?: string;
  readonly requires: readonly string[];
  readonly archetypes?: readonly { readonly slug: string; readonly convention: string }[];
}

interface BuiltInNapplet extends BuiltInNappletMetadata {
  readonly name: string;
  readonly dist: string;
  readonly files: readonly { readonly path: string; readonly sha256: string; readonly mediaType: string }[];
}

const mediaTypes: Readonly<Record<string, string>> = {
  html: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", wasm: "application/wasm", txt: "text/plain",
  xml: "application/xml", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm"
};

const walk = (root: string, current = root): string[] => readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
  const path = join(current, entry.name);
  return entry.isDirectory() ? walk(root, path) : [relative(root, path).split(sep).join("/")];
});

export const isRuntimeArtifact = (path: string): boolean => path !== ".nip5a-manifest.json";

export function discoverBuiltInNapplets(repositoryRoot: string): BuiltInNapplet[] {
  const nappletsRoot = join(repositoryRoot, "napplets");
  return readdirSync(nappletsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const appRoot = join(nappletsRoot, entry.name);
    const packagePath = join(appRoot, "package.json");
    const entrypoint = join(appRoot, "dist", "index.html");
    if (!statExists(packagePath) || !statExists(entrypoint)) return [];
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; napplet?: BuiltInNappletMetadata };
    if (!packageJson.napplet) return [];
    const dist = dirname(entrypoint);
    const files = walk(dist).filter(isRuntimeArtifact).map((path) => {
      const bytes = readFileSync(join(dist, path));
      const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      return { path, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: mediaTypes[extension] ?? "application/octet-stream" };
    });
    return [{ ...packageJson.napplet, name: packageJson.napplet.dTag, dist, files }];
  });
}

const statExists = (path: string): boolean => {
  try { return statSync(path).isFile(); } catch { return false; }
};

const registry = (napplets: readonly BuiltInNapplet[], base: string, development: boolean): string => JSON.stringify({
  version: 1,
  napplets: napplets.map(({ dist: _dist, ...napplet }) => ({
    ...napplet,
    url: `${base}${development ? "napplets.dev" : "napplets"}/${encodeURIComponent(napplet.dTag)}/index.html`
  }))
}, null, 2);

const safeArtifact = (napplet: BuiltInNapplet, requestedPath: string): string | undefined => {
  const normalized = requestedPath.split("/").filter(Boolean).join("/");
  if (!napplet.files.some((file) => file.path === normalized)) return undefined;
  const resolved = resolve(napplet.dist, normalized);
  return resolved.startsWith(`${resolve(napplet.dist)}${sep}`) ? resolved : undefined;
};

export function builtInNapplets(repositoryRoot: string): Plugin {
  let base = "/";
  const serve = (server: ViteDevServer): void => {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      const registryPath = `${base}napplets.dev.json`.replace(/\/+/g, "/");
      const artifactBase = `${base}napplets.dev/`.replace(/\/+/g, "/");
      const napplets = discoverBuiltInNapplets(repositoryRoot);
      if (pathname === registryPath) {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(registry(napplets, base, true));
        return;
      }
      if (!pathname.startsWith(artifactBase)) { next(); return; }
      const [encodedName, ...segments] = pathname.slice(artifactBase.length).split("/");
      if (!encodedName) { response.statusCode = 404; response.end("Napplet name missing"); return; }
      const napplet = napplets.find((item) => item.dTag === decodeURIComponent(encodedName));
      const artifact = napplet && safeArtifact(napplet, segments.map(decodeURIComponent).join("/"));
      if (!artifact) { response.statusCode = 404; response.end("Napplet dist file is not built yet"); return; }
      const declaration = napplet.files.find((file) => artifact.endsWith(file.path.split("/").join(sep)));
      response.setHeader("Content-Type", `${declaration?.mediaType ?? "application/octet-stream"}; charset=utf-8`);
      response.setHeader("Cache-Control", "no-store");
      response.end(readFileSync(artifact));
    });
  };
  return {
    name: "platform-built-in-napplets",
    configResolved(config) { base = config.base; },
    configureServer: serve,
    generateBundle() {
      const napplets = discoverBuiltInNapplets(repositoryRoot);
      if (napplets.length === 0) this.warn("No built Napplets found");
      for (const napplet of napplets) for (const file of napplet.files) {
        this.emitFile({ type: "asset", fileName: `napplets/${napplet.dTag}/${file.path}`, source: readFileSync(join(napplet.dist, file.path)) });
      }
      this.emitFile({ type: "asset", fileName: "napplets.json", source: registry(napplets, base, false) });
    }
  };
}
