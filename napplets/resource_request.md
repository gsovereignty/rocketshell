# Requesting External Resources from a Napplet

Napplets run in sandboxed, opaque-origin iframes. They must not fetch remote data directly or assign remote URLs to browser elements.

Use NAP-RESOURCE:

```text
remote URL
  -> resource.bytes(url)
  -> shell policy and network fetch
  -> Blob returned to napplet
  -> local blob: URL when needed
  -> browser element or parser
```

This design keeps network authority in the shell. Napplet code receives only bytes approved and classified by that shell.

## 1. Declare the resource domain

Add `resource` to the NIP-5A manifest requirements. Exact build configuration depends on the project toolchain; with `@napplet/vite-plugin`, the relevant part is:

```ts
nip5aManifest({
  nappletType: 'my-napplet',
  requires: ['resource'],
  artifactMode: 'single-file',
});
```

List all other NAP domains used by the napplet too. Preserve the single-file artifact: runtime scripts and static assets must be folded into built `index.html`.

When remote resources are optional, test domain availability after runtime injection and provide fallback UI:

```ts
const resourceAvailable = Boolean(window.napplet?.resource);
```

Use direct `window.napplet` access only for availability checks. Make calls through `@napplet/sdk`.

## 2. Fetch bytes through the SDK

```ts
import { resource } from '@napplet/sdk';

const blob = await resource.bytes(remoteUrl);
```

Do not use ambient browser network access:

```ts
fetch(remoteUrl); // wrong
new XMLHttpRequest(); // wrong
img.src = remoteUrl; // wrong for remote URL
element.style.backgroundImage = `url(${remoteUrl})`; // wrong
```

URLs may come from events, metadata, intent payloads, configuration, or user input. Treat every URL as data. Shell decides whether it may be fetched.

## 3. Convert image bytes into local URLs

```ts
import { resource } from '@napplet/sdk';

export async function requestImage(url: string, signal?: AbortSignal): Promise<string> {
  if (!url || !window.napplet?.resource) return '';

  try {
    const blob = await resource.bytes(url, { signal });
    if (!blob.type.startsWith('image/')) return '';
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}
```

Render returned URL, not original URL:

```ts
const objectUrl = await requestImage(remoteUrl);

if (objectUrl) {
  imageElement.src = objectUrl;
} else {
  showImagePlaceholder();
}
```

If installed SDK supplies `resource.bytesAsObjectURL()`, its handle may manage cleanup:

```ts
const handle = resource.bytesAsObjectURL(remoteUrl);
imageElement.src = handle.url;

// Teardown:
handle.revoke();
```

Check installed SDK types before selecting convenience methods. `resource.bytes()` plus `URL.createObjectURL()` is portable.

## 4. Own object-URL lifecycle

Every created object URL consumes browser memory. Caller must revoke it.

Framework-independent lifecycle:

```ts
let currentObjectUrl = '';
let requestVersion = 0;

async function displayImage(remoteUrl: string): Promise<void> {
  const version = ++requestVersion;

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = '';
  showLoadingState();

  const nextUrl = await requestImage(remoteUrl);

  if (version !== requestVersion) {
    if (nextUrl) URL.revokeObjectURL(nextUrl);
    return;
  }

  currentObjectUrl = nextUrl;
  if (nextUrl) showImage(nextUrl);
  else showUnavailableState();
}

function dispose(): void {
  requestVersion += 1;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = '';
}
```

Adapt `displayImage()` and `dispose()` to framework mount, update, and teardown hooks.

Each component must:

1. Mark old request stale when input changes.
2. Refuse to install stale results.
3. Revoke stale results immediately.
4. Revoke displayed URL when replaced or destroyed.
5. Reset loading and fallback states on input change.

An `AbortController` can cancel work, but stale-result checking remains necessary because completion and teardown can race.

## 5. Load non-image bytes

Use returned blob directly for documents, models, archives, media, or structured data:

```ts
import { resource } from '@napplet/sdk';

async function loadBinaryFile(url: string): Promise<Uint8Array> {
  const blob = await resource.bytes(url);
  return new Uint8Array(await blob.arrayBuffer());
}
```

Validate bytes for expected format before parsing. Do not trust URL extension, event-provided MIME, or upstream `Content-Type`.

For multiple resources, use `resource.bytesMany()` when its result and failure semantics fit the UI. Otherwise queue individual `resource.bytes()` calls with small concurrency limit. Never start an unbounded request per list row.

## 6. Handle failures as normal states

Resources may be missing, blocked, too large, unsupported, unavailable, or slow.

Useful UI states:

- pending: loading indicator or skeleton;
- loaded: decoded content or local blob URL;
- unavailable: initials, alt text, file-type label, or neutral placeholder;
- essential resource failure: concise, retryable error.

When branching on SDK errors, use documented error codes rather than message strings. Shell implementations may normalize internal refusals to broader codes such as `network-error`, so fallback behavior should tolerate less-specific errors.

## 7. Do not assume shell policy

Supported schemes, byte limits, timeouts, concurrency, redirects, MIME handling, and SVG behavior belong to shell implementation. A napplet may inspect published NAP-RESOURCE information when API supports it, but must not treat one shell's defaults as universal.

Use early client-side checks only to improve UX. Shell remains authority and may apply stricter policy.

## 8. Verification checklist

- `resource` appears in manifest requirements when mandatory.
- No direct `fetch`, `XMLHttpRequest`, `WebSocket`, remote element source, or remote CSS URL exists.
- All external bytes pass through SDK resource methods.
- Every created object URL has matching revoke path.
- URL changes cannot install stale results.
- Missing optional resource domain has useful fallback.
- Failed image has useful placeholder.
- Non-image data is validated before parsing.
- List loading has bounded concurrency.
- Napplet remains single-file artifact.
- Project build, type checks, and tests pass.
- Napplet conformance passes before publishing.

Never publish a napplet merely to test resource loading. Build and verify locally first.
