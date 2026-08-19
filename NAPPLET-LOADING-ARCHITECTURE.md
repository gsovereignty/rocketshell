# Loading Built-In Napplets from a Monorepo

This document describes a generic architecture for discovering, building, packaging, resolving, and loading napplets that live inside an existing monorepo. It deliberately separates source layout from runtime loading: the host never imports napplet source code. It loads built HTML artifacts through the same boundary used for externally published napplets.

## Core model

A typical workspace has two distinct application types:

```text
repository/
├── apps/
│   └── host/                  # Shell application
└── napplets/
    ├── catalog/
    │   ├── src/
    │   └── dist/index.html   # Loadable artifact
    ├── item-detail/
    │   ├── src/
    │   └── dist/index.html
    └── item-editor/
        ├── src/
        └── dist/index.html
```

Each napplet is an independent application. Its folder name normally doubles as its stable identifier, deployment `d` tag, registry name, and artifact directory name. Keeping those values identical removes an otherwise error-prone translation layer.

The host consumes `dist/index.html`, not `src/`. A single-file HTML artifact is especially useful because the host can fetch one value, inject its runtime bridge, and assign the result to an iframe using `srcdoc`. Multi-file artifacts can also work, but they require stable base URLs and careful handling of relative CSS, JavaScript, WASM, font, and image references.

## End-to-end flow

Loading has six stages:

1. A route or intent requests a product archetype.
2. Configuration maps that archetype to a napplet identifier.
3. A registry maps the identifier to an artifact URL.
4. The host fetches the built HTML artifact.
5. The host derives declared capabilities and prepares the runtime boundary.
6. The host boots the transformed HTML inside a sandboxed iframe.

```text
route / intent
    |
    v
archetype, such as "item-detail"
    |
    v
configured napplet descriptor
    |  identifier, title, artifact identity, source
    v
development or production registry
    |
    v
same-origin HTML artifact
    |
    v
capability extraction + bridge injection + sandbox sealing
    |
    v
iframe srcdoc
```

Source presence alone does not make a napplet loadable. A napplet becomes loadable only after it produces the expected artifact and can be resolved from an archetype or explicit configuration.

## 1. Archetypes select behavior, not files

Host routes should request semantic archetypes instead of hard-coding workspace paths:

```ts
type ArchetypeEntry = {
  dTag: string;
  title: string;
  description?: string;
};

const archetypes: Record<string, ArchetypeEntry> = {
  'item-catalog': { dTag: 'catalog', title: 'Catalog' },
  'item-detail': { dTag: 'item-detail', title: 'Item details' },
  'item-editor': { dTag: 'item-editor', title: 'Item editor' },
};
```

This indirection gives routes stable product meaning while allowing implementations to change. A route asks for `item-detail`; configuration decides which napplet supplies it.

A resolved descriptor commonly contains:

```ts
type ResolvedNapplet = {
  archetype: string;
  dTag: string;
  title: string;
  description?: string;
  aggregateHash: string;
  artifactUrl: string;
  conventions: string[];
  source: 'default' | 'override';
};
```

`aggregateHash` identifies artifact contents or release identity. `conventions` identify protocol contracts supported for the archetype. `source` controls later resolution and caching behavior.

Resolution usually follows this precedence:

```ts
function resolveConfiguredNapplet(archetype: string): ResolvedNapplet | null {
  const override = settings.nappletOverrides[archetype];
  if (override) return resolveOverride(archetype, override);
  return resolveBuiltInDefault(archetype);
}
```

An unknown archetype should produce a visible configuration error. Silently choosing an unrelated napplet makes route behavior unpredictable.

## 2. Build every napplet independently

Each workspace builds its own application into `napplets/<name>/dist/`. A valid built-in napplet must at least provide:

```text
napplets/<name>/dist/index.html
```

For a single-file contract, JavaScript and CSS are inlined into that document. Build tooling should also embed manifest metadata, including required NAP domains, before signing or hashing the artifact.

Example metadata:

```html
<meta name="napplet-requires" content="identity,outbox,resource,intent" />
```

The aggregate build should run napplet builds before the host build. Otherwise host packaging may succeed while shipping an empty registry. Useful build invariant:

```text
napplet builds complete
    before
host bundle scans napplets/*/dist/index.html
```

Build scanners should include only directories containing `dist/index.html`. This prevents incomplete workspaces, documentation folders, and stale package directories from appearing in the runtime registry.

## 3. Development discovery and serving

Development mode needs two generated surfaces:

- a registry, such as `/napplets.dev.json`;
- artifact routes, such as `/napplets.dev/<name>/index.html`.

Example registry:

```json
{
  "version": 1,
  "napplets": [
    {
      "name": "catalog",
      "url": "http://127.0.0.1:5173/napplets.dev/catalog/index.html"
    },
    {
      "name": "item-detail",
      "url": "http://127.0.0.1:5173/napplets.dev/item-detail/index.html"
    }
  ]
}
```

A development launcher usually performs this sequence:

1. Enumerate napplet workspaces.
2. Start each napplet build in watch mode.
3. Generate the local registry.
4. Start the host development server.
5. Serve each request from the corresponding workspace `dist/` directory.

The host server can expose `dist/` through middleware rather than running one development server per napplet. Given `/napplets.dev/item-detail/index.html`, middleware resolves:

```text
<repository>/napplets/item-detail/dist/index.html
```

Middleware must normalize paths and prove the resolved file remains under the selected `dist/` root. Reject traversal segments and platform path separators before reading files. Missing artifacts should return a direct build-oriented error, for example:

```text
Napplet dist file is not built yet: item-detail/index.html
```

The development registry is generated state. It may contain machine-specific origins and ports, so it should be ignored by source control and removed from production output.

## 4. Production packaging

Production cannot depend on workspace directories existing beside the deployed host. The host build copies all eligible napplet artifacts into its own static output:

```text
host-dist/
├── index.html
├── napplets.json
└── napplets/
    ├── catalog/index.html
    ├── item-detail/index.html
    └── item-editor/index.html
```

Generic bundler logic:

```ts
for (const napplet of listBuiltNapplets()) {
  for (const file of walkFiles(napplet.dist)) {
    emitAsset(`napplets/${napplet.name}/${file}`, read(napplet.dist, file));
  }

  registry.push({
    name: napplet.name,
    url: `/napplets/${napplet.name}/index.html`,
  });
}

emitAsset('napplets.json', JSON.stringify({ version: 1, napplets: registry }));
```

Recursively copying the whole `dist/` directory keeps this compatible with multi-file artifacts even when current napplets use single-file output.

Development and production URLs should be symmetric:

```text
development: /napplets.dev/<dTag>/index.html
production:  /napplets/<dTag>/index.html
```

Only base path and registry filename change. Runtime resolution stays identical.

Production build should warn or fail when no built napplets exist. Warning permits host-only builds, while failure gives stronger assurance that a release cannot omit required built-ins. Choose based on release policy.

## 5. Registry resolution with deterministic fallback

Runtime picks paths from build mode:

```ts
const assetBase = development ? '/napplets.dev' : '/napplets';
const registryUrl = development ? '/napplets.dev.json' : '/napplets.json';

function defaultArtifactUrl(dTag: string): string {
  return `${assetBase}/${dTag}/index.html`;
}
```

For a built-in descriptor, loader fetches registry without browser caching, finds matching `name`, and uses its URL. If registry is missing, malformed, unavailable, or lacks that entry, loader falls back to deterministic same-origin URL.

```ts
async function resolveRegistryUrl(name: string): Promise<string> {
  const fallback = defaultArtifactUrl(name);

  try {
    const response = await fetch(registryUrl, { cache: 'no-store' });
    if (!response.ok) return fallback;
    const registry = await response.json();
    return registry.napplets?.find((entry) => entry.name === name)?.url ?? fallback;
  } catch {
    return fallback;
  }
}
```

Registry remains useful because it can carry absolute development URLs or future content-addressed locations. Deterministic fallback prevents registry failure from breaking an otherwise correctly packaged artifact.

## 6. Artifact fetching and caching

Loader fetches artifact HTML rather than navigating iframe directly:

```ts
const response = await fetch(url, { cache: 'no-store' });
if (!response.ok) throw new Error(describeFailure(response));
const html = await response.text();
```

Fetching first lets host:

- inspect capability declarations;
- inject protocol bootstrap code;
- install guards before napplet code runs;
- register artifact identity before boot;
- provide clearer missing-build errors;
- use `srcdoc` without granting iframe same-origin navigation privileges.

Production built-ins can be memoized with a key containing all identity inputs:

```text
<dTag>:<aggregateHash>:<resolved URL>
```

Cache promises, not only completed values, so concurrent mounts share one request. Remove failed promises from cache, allowing later retries. Development should normally bypass this in-memory cache so rebuilds appear immediately.

HTTP cache policy and application memoization are separate. `cache: 'no-store'` avoids stale registry or HTML responses; an explicit production promise cache still prevents duplicate work within one running host session.

## 7. Capability extraction

After fetching HTML, host parses declared NAP domains:

```ts
function readDomains(html: string): string[] {
  const content = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector('meta[name="napplet-requires"]')
    ?.getAttribute('content');

  if (!content) return [];

  return content
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean);
}
```

These declarations form input to host grant construction. They do not themselves implement a domain. Three pieces must align:

1. Napplet build declares domain.
2. Host grants domain to this napplet instance.
3. Host runtime or registered service handles domain messages.

Missing declaration means SDK surface may never be injected. Declared but unhandled domain means calls still fail or remain unrouted. Loader should warn when no domains are present because this often means manifest generation was skipped during build.

## 8. Register before boot

Iframe window and artifact identity should be registered before assigning `srcdoc`. Napplet JavaScript can run immediately after assignment and may announce readiness before later host bookkeeping finishes.

Typical registration data:

```ts
originRegistry.register(iframe.contentWindow, windowId, {
  dTag: loaded.dTag,
  aggregateHash: loaded.aggregateHash,
});

sessionRegistry.register(windowId, {
  windowId,
  dTag: loaded.dTag,
  aggregateHash: loaded.aggregateHash,
  instanceId: windowId,
  provenance: 'napplet',
  registeredAt: Date.now(),
});
```

This ordering allows message routing and provenance checks to recognize first message emitted by napplet.

If route carries an intent payload, buffer it before boot as well. Otherwise napplet can signal readiness before payload exists, causing lost initial navigation state. Use a mutable reference so payload changed during asynchronous fetch becomes seeded value.

## 9. Transform and boot iframe

Final HTML should be composed in controlled order:

1. Start from fetched artifact HTML.
2. Inject runtime namespace prelude for granted domains.
3. Install frame guards ahead of napplet application code.
4. Assign transformed document to iframe `srcdoc`.

```ts
const prepared = injectRuntimePrelude(loaded.html, {
  domains: loaded.domains,
});

iframe.srcdoc = sealFrame(prepared);
```

Frame should use restrictive sandboxing, commonly:

```html
<iframe sandbox="allow-scripts"></iframe>
```

Omitting `allow-same-origin` gives `srcdoc` an opaque origin. Napplet communicates through injected message-based APIs rather than direct DOM or host-global access.

Any prohibited ambient API must be sealed before napplet code executes. Appending guards after application scripts is too late because parser execution order may let napplet capture references first.

Unmount cleanup should unregister window/session state, cancel pending intent delivery, and ignore completion from stale asynchronous loads. A cancellation flag prevents an artifact fetched for an old route from booting after component replacement.

## 10. External overrides use same mount path

Built-in and external napplets should converge after descriptor resolution:

```text
built-in archetype mapping --+
                             +-- ResolvedNapplet -- load -- mount
external manifest override --+
```

Only artifact discovery differs:

- built-ins resolve through local registry plus same-origin fallback;
- overrides resolve from persisted manifest metadata or published address.

External resolution should validate required manifest fields before producing descriptor:

- stable `d` tag;
- aggregate hash;
- loadable artifact URL;
- expected manifest kind;
- archetype/convention compatibility, when applicable.

Artifact URL policy should be explicit. Common baseline accepts HTTPS universally and permits HTTP only for local development infrastructure. Compatibility should be shown separately from loadability: an artifact may be technically fetchable but not claim expected archetype convention.

Once resolved, both sources use same capability extraction, registration, bridge injection, sandboxing, intent delivery, and cleanup code. One mount path prevents built-ins from gaining accidental privileges unavailable to third-party napplets.

## 11. Common failure modes

### Source exists but host reports missing artifact

Cause: `dist/index.html` absent. Build workspace or start aggregate development command that runs build watchers.

### Artifact exists but route says no napplet configured

Cause: folder is not mapped to requested archetype and no override exists. Add semantic mapping; artifact scanning alone does not decide route ownership.

### Napplet loads but APIs are absent

Cause: capability metadata missing from built HTML, domain omitted from manifest declaration, or build plugin skipped manifest generation.

### Napplet declares API but calls remain unrouted

Cause: host granted domain but registered no runtime/service handler.

### Development works but production does not

Likely causes:

- host built before napplets;
- production bundle did not copy napplet outputs;
- generated production registry omitted entry;
- stale development registry leaked into deployment;
- absolute development URLs were packaged accidentally.

### Production works but rebuilds appear stale in development

Cause: application memoization enabled during development, browser cache not disabled, or watch build has not rewritten `dist/index.html`.

### Initial intent sometimes disappears

Cause: napplet signals ready before host buffers payload. Seed delivery before assigning `srcdoc`.

### First protocol message is rejected

Cause: iframe window/session registration occurs after boot. Register before assigning `srcdoc`.

### Relative assets fail under `srcdoc`

Cause: multi-file artifact assumes document URL as base. Prefer single-file artifact or inject valid `<base href="...">` tied to resolved artifact directory.

## 12. Portability checklist

To apply this design to another repository:

- Define napplet workspace root, such as `napplets/*`.
- Require stable folder name and `d` tag relationship.
- Configure every workspace to emit `dist/index.html`.
- Prefer single-file artifact mode.
- Embed required NAP domains into HTML metadata.
- Build napplets before host packaging.
- Generate development registry from discovered workspaces.
- Serve development artifacts from workspace `dist/` directories.
- Normalize and contain-check all development file paths.
- Copy production artifacts under host static output.
- Generate production registry using deployment-safe URLs.
- Remove development registry from production output.
- Map semantic archetypes to default napplet identifiers.
- Let explicit override beat default mapping.
- Resolve registry URL with deterministic same-origin fallback.
- Fetch HTML before iframe boot.
- Parse capabilities and construct least-required grants.
- Register iframe identity before application code starts.
- Buffer initial intent before readiness can fire.
- Inject bridge and guards before napplet scripts.
- Mount with restrictive iframe sandbox.
- Clean registry state on unmount.
- Disable in-memory artifact caching during development.
- Include artifact identity in production cache keys.
- Test missing build, missing registry, stale load, and first-message races.

## Design principle

Treat built-in napplets as packaged applications, not privileged source modules. Monorepo makes development and bundling convenient; it should not erase runtime boundary. Same descriptor, loader, capability checks, registration order, sandbox, and message bridge should govern every napplet regardless of where its source was written.
