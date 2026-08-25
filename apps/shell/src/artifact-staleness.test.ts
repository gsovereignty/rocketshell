import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInNappletBuildId, builtInNapplets, discoverBuiltInNapplets, nappletRegistryJson, packagedRegistryDrift, staleNapplets } from "../vite.napplets.js";
import { isRetiredShellCache, shellCacheName } from "./service-worker-cache";

const repositoryRoot = resolve(__dirname, "../../..");
const shellDist = resolve(__dirname, "../dist");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const napplet = (root: string, name: string, options: { source: number; artifact: number; body?: string }) => {
  const app = join(root, "napplets", name);
  mkdirSync(join(app, "src"), { recursive: true });
  mkdirSync(join(app, "dist"), { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ name, napplet: { dTag: name, requires: [] } }));
  const source = join(app, "src", "main.ts");
  const artifact = join(app, "dist", "index.html");
  writeFileSync(source, "export {};");
  writeFileSync(artifact, options.body ?? "<html></html>");
  utimesSync(source, options.source, options.source);
  utimesSync(artifact, options.artifact, options.artifact);
  return { app, source, artifact };
};

const workspace = () => mkdtempSync(join(tmpdir(), "artifact-staleness-"));

describe("source-newer-than-artifact detection", () => {
  it("names every napplet whose src outdates its dist, whatever the napplet is", () => {
    const root = workspace();
    napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    napplet(root, "beta", { source: 2_000, artifact: 1_000 });
    napplet(root, "gamma", { source: 5_000, artifact: 4_999 });
    expect(staleNapplets(root).sort()).toEqual(["beta", "gamma"]);
  });

  it("treats a rebuilt artifact as fresh again", () => {
    const root = workspace();
    const { artifact } = napplet(root, "alpha", { source: 2_000, artifact: 1_000 });
    expect(staleNapplets(root)).toEqual(["alpha"]);
    utimesSync(artifact, 3_000, 3_000);
    expect(staleNapplets(root)).toEqual([]);
  });
});

describe("packaged-snapshot drift detection", () => {
  // Packaging goes through the same emitter the shell build uses, so drift is the only variable.
  const packageInto = (root: string, outDir: string, base = "/") => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "napplets.json"), nappletRegistryJson(discoverBuiltInNapplets(root), base, false));
  };

  it("passes when the snapshot describes the current artifacts", () => {
    const root = workspace();
    napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    const outDir = join(root, "out");
    packageInto(root, outDir);
    expect(packagedRegistryDrift(root, outDir, "/")).toBeUndefined();
  });

  it("detects a changed artifact behind an unchanged snapshot", () => {
    const root = workspace();
    const { artifact } = napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    const outDir = join(root, "out");
    packageInto(root, outDir);
    writeFileSync(artifact, "<html>rebuilt</html>");
    expect(packagedRegistryDrift(root, outDir, "/")).toMatch(/different Napplet artifacts/);
  });

  it("detects a napplet added or removed after packaging", () => {
    const root = workspace();
    napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    const outDir = join(root, "out");
    packageInto(root, outDir);
    napplet(root, "beta", { source: 1_000, artifact: 2_000 });
    expect(packagedRegistryDrift(root, outDir, "/")).toMatch(/different Napplet artifacts/);
  });

  it("reports a missing snapshot rather than silently passing", () => {
    const root = workspace();
    napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    expect(packagedRegistryDrift(root, join(root, "never-built"), "/")).toMatch(/is missing/);
  });

  it("notices a base-path change, which would break every artifact URL", () => {
    const root = workspace();
    napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    const outDir = join(root, "out");
    packageInto(root, outDir, "/");
    expect(packagedRegistryDrift(root, outDir, "/rocketshell/")).toMatch(/different Napplet artifacts/);
  });
});

describe("preview refuses to serve a stale snapshot", () => {
  const configure = (root: string, outDir: string, base: string) => {
    const plugin = builtInNapplets(root) as unknown as {
      configResolved: (config: unknown) => void;
      configurePreviewServer: () => void;
    };
    plugin.configResolved({ base, root: dirname(outDir), build: { outDir } });
    return plugin;
  };

  it("throws when the packaged snapshot no longer matches the artifacts", () => {
    const root = workspace();
    const { artifact } = napplet(root, "alpha", { source: 1_000, artifact: 2_000 });
    const outDir = join(root, "app", "dist");
    mkdirSync(outDir, { recursive: true });
    const plugin = configure(root, outDir, "/");
    expect(() => plugin.configurePreviewServer()).toThrow(/stale shell build/);
    writeFileSync(artifact, "<html>rebuilt</html>");
    expect(() => plugin.configurePreviewServer()).toThrow(/stale shell build/);
  });
});

describe("service worker cache identity", () => {
  it("changes whenever built-in Napplet bytes change", () => {
    const root = workspace();
    const { artifact } = napplet(root, "alpha", { source: 1_000, artifact: 2_000, body: "first" });
    const before = builtInNappletBuildId(root);
    writeFileSync(artifact, "second");
    expect(builtInNappletBuildId(root)).not.toBe(before);
  });

  it("is deterministic for identical built-in Napplet bytes", () => {
    const left = workspace();
    const right = workspace();
    napplet(left, "alpha", { source: 1_000, artifact: 2_000, body: "same" });
    napplet(right, "alpha", { source: 5_000, artifact: 6_000, body: "same" });
    expect(builtInNappletBuildId(left)).toBe(builtInNappletBuildId(right));
  });

  it("gives each build its own cache so a rebuild can never be served from an old one", () => {
    expect(shellCacheName("a1")).not.toBe(shellCacheName("b2"));
  });

  it("retires every cache that is not the current build", () => {
    const current = shellCacheName("current");
    expect(isRetiredShellCache(shellCacheName("previous"), current)).toBe(true);
    expect(isRetiredShellCache(current, current)).toBe(false);
    expect(isRetiredShellCache("unrelated-cache", current)).toBe(false);
  });
});

describe("this repository's packaged shell", () => {
  it.runIf(existsSync(join(shellDist, "napplets.json")))(
    "serves byte-identical artifacts to every napplets/*/dist it packaged",
    () => {
      const snapshot = JSON.parse(readFileSync(join(shellDist, "napplets.json"), "utf8")) as {
        napplets: { dTag: string; files: { path: string; sha256: string }[] }[];
      };
      expect(snapshot.napplets.length).toBeGreaterThan(0);
      for (const item of snapshot.napplets) {
        for (const file of item.files) {
          const packaged = join(shellDist, "napplets", item.dTag, file.path);
          const source = join(repositoryRoot, "napplets", item.dTag, "dist", file.path);
          expect(sha256(readFileSync(packaged)), `${item.dTag}/${file.path} packaged copy`).toBe(file.sha256);
          expect(sha256(readFileSync(source)), `${item.dTag}/${file.path} source of truth`).toBe(file.sha256);
        }
      }
    }
  );
});
