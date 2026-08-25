import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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
  return existsSync(path) && statSync(path).isFile();
};

export function builtInNappletBuildId(repositoryRoot: string): string {
  const artifacts = discoverBuiltInNapplets(repositoryRoot).map(({ dTag, files }) => ({
    dTag,
    files: [...files].sort((left, right) => left.path.localeCompare(right.path))
  })).sort((left, right) => left.dTag.localeCompare(right.dTag));
  return createHash("sha256").update(JSON.stringify(artifacts)).digest("hex").slice(0, 20);
}

export const nappletRegistryJson = (napplets: readonly BuiltInNapplet[], base: string, development: boolean): string => JSON.stringify({
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

const newestMtime = (root: string): number => {
  if (!existsSync(root)) return 0;
  return walk(root).reduce((newest, path) => Math.max(newest, statSync(join(root, path)).mtimeMs), 0);
};

export function staleNapplets(repositoryRoot: string): string[] {
  return discoverBuiltInNapplets(repositoryRoot).filter((napplet) => {
    const source = newestMtime(resolve(napplet.dist, "..", "src"));
    const artifact = newestMtime(napplet.dist);
    return source > 0 && artifact > 0 && source > artifact;
  }).map((napplet) => napplet.name);
}

/* Chokidar 4 has no glob support, so each dist directory is registered by path.
   Registration repeats whenever the registry is read, which picks up Napplets built after startup.
   Files present at registration are inventoried: chokidar replays them as "add" events, and those
   describe the state the page is already loading, not a rebuild worth reloading for. */
const artifactWatchers = new WeakMap<ViteDevServer, Set<string>>();

/* Watcher events and configured paths can disagree about symlinked parents
   (macOS /var vs /private/var), so every path is compared as a real path. */
const realPath = (path: string): string => {
  return existsSync(path) ? realpathSync(path) : resolve(path);
};

const watchNappletArtifacts = (server: ViteDevServer, repositoryRoot: string): void => {
  let inventory = artifactWatchers.get(server);
  if (!inventory) {
    inventory = new Set<string>();
    artifactWatchers.set(server, inventory);
  }
  for (const napplet of discoverBuiltInNapplets(repositoryRoot)) {
    for (const file of napplet.files) inventory.add(realPath(join(napplet.dist, file.path)));
    server.watcher.add(napplet.dist);
  }
};

const reloadOnArtifactChange = (server: ViteDevServer, repositoryRoot: string): void => {
  const nappletsRoot = realPath(join(repositoryRoot, "napplets"));
  let pending: NodeJS.Timeout | undefined;
  server.watcher.on("all", (event, changed) => {
    const path = realPath(changed);
    if (!path.startsWith(`${nappletsRoot}${sep}`) || !path.includes(`${sep}dist${sep}`)) return;
    const inventory = artifactWatchers.get(server);
    if (event === "add" && inventory?.delete(path)) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      server.config.logger.info("napplet artifact changed, reloading shell");
      server.hot.send({ type: "full-reload", path: "*" });
    }, 120);
  });
};

export function packagedRegistryDrift(repositoryRoot: string, outDir: string, base: string): string | undefined {
  const packagedPath = join(outDir, "napplets.json");
  let packaged: string;
  try {
    packaged = readFileSync(packagedPath, "utf8");
  } catch {
    return `${packagedPath} is missing — build the shell before previewing it`;
  }
  const current = nappletRegistryJson(discoverBuiltInNapplets(repositoryRoot), base, false);
  if (packaged === current) return undefined;
  return `${packagedPath} packages different Napplet artifacts than napplets/*/dist — rebuild the shell`;
}

export function builtInNapplets(repositoryRoot: string): Plugin {
  let base = "/";
  let outDir = "dist";
  const serve = (server: ViteDevServer): void => {
    watchNappletArtifacts(server, repositoryRoot);
    reloadOnArtifactChange(server, repositoryRoot);
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://vite.local").pathname;
      const registryPath = `${base}napplets.dev.json`.replace(/\/+/g, "/");
      const artifactBase = `${base}napplets.dev/`.replace(/\/+/g, "/");
      const napplets = discoverBuiltInNapplets(repositoryRoot);
      watchNappletArtifacts(server, repositoryRoot);
      if (pathname === registryPath) {
        const stale = staleNapplets(repositoryRoot);
        if (stale.length > 0) {
          const message = `Napplet dist is older than src: ${stale.join(", ")}. Rebuild stale Napplet artifacts before loading the shell.`;
          server.config.logger.error(message);
          response.statusCode = 503;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Retry-After", "1");
          response.setHeader("X-Napplet-Stale", stale.join(","));
          response.end(JSON.stringify({ error: "stale-napplet-artifacts", message, napplets: stale }));
          return;
        }
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Napplet-Stale", stale.join(",") || "none");
        response.end(nappletRegistryJson(napplets, base, true));
        return;
      }
      if (!pathname.startsWith(artifactBase)) { next(); return; }
      const [encodedName, ...segments] = pathname.slice(artifactBase.length).split("/");
      if (!encodedName) { response.statusCode = 404; response.end("Napplet name missing"); return; }
      const napplet = napplets.find((item) => item.dTag === decodeURIComponent(encodedName));
      if (napplet && staleNapplets(repositoryRoot).includes(napplet.dTag)) {
        response.statusCode = 503;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Retry-After", "1");
        response.setHeader("X-Napplet-Stale", napplet.dTag);
        response.end(`Napplet dist is older than src: ${napplet.dTag}. Rebuild stale Napplet artifacts before loading it.`);
        return;
      }
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
    configResolved(config) { base = config.base; outDir = resolve(config.root, config.build.outDir); },
    configureServer: serve,
    configurePreviewServer() {
      const drift = packagedRegistryDrift(repositoryRoot, outDir, base);
      if (drift) throw new Error(`Refusing to preview a stale shell build: ${drift}`);
    },
    generateBundle() {
      const napplets = discoverBuiltInNapplets(repositoryRoot);
      if (napplets.length === 0) this.warn("No built Napplets found");
      const stale = staleNapplets(repositoryRoot);
      if (stale.length > 0) {
        this.error(`Refusing to package stale Napplet artifacts: ${stale.join(", ")}. Run pnpm --filter '@platform/*-napplet' build first.`);
      }
      for (const napplet of napplets) for (const file of napplet.files) {
        this.emitFile({ type: "asset", fileName: `napplets/${napplet.dTag}/${file.path}`, source: readFileSync(join(napplet.dist, file.path)) });
      }
      this.emitFile({ type: "asset", fileName: "napplets.json", source: nappletRegistryJson(napplets, base, false) });
    }
  };
}
