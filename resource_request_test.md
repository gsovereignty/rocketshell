# Testing a Shell's NAP-RESOURCE Implementation

This guide tests shell behavior, not only napplet UI. Test must drive real napplet inside real sandboxed iframe, send NAP-RESOURCE request over runtime bridge, and observe both controlled resource server and result inside frame.

Napplet conformance alone is insufficient. Conformance proves napplet speaks NIP-5D correctly against reference shell; it does not prove another shell's resource policy or fetch implementation.

## Test architecture

```text
test napplet
  -> resource.bytes(fixture URL)
  -> iframe protocol bridge
  -> shell resource handler
  -> controlled fixture server
  -> shell validation
  -> Blob or error returned to napplet
  -> observable result in iframe DOM
```

This covers integration among manifest grants, SDK encoding, runtime routing, shell handler, browser networking, response validation, and delivery back into sandbox.

## 1. Build a dedicated test napplet

Create small napplet used only by tests. Do not mock `window.napplet`; real bridge traffic is point of suite.

Manifest needs `resource` and single-file artifact:

```ts
nip5aManifest({
  nappletType: 'resource-test',
  requires: ['resource'],
  artifactMode: 'single-file',
});
```

Give napplet URL input and request button. Browser automation can drive it like user while SDK performs real call:

```ts
import { resource } from '@napplet/sdk';

async function request(url: string): Promise<void> {
  document.body.dataset.result = '';

  try {
    const blob = await resource.bytes(url);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    document.body.dataset.result = JSON.stringify({
      ok: true,
      type: blob.type,
      size: blob.size,
      firstBytes: [...bytes.slice(0, 16)],
    });
  } catch (error) {
    document.body.dataset.result = JSON.stringify({
      ok: false,
      code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown',
    });
  }
}
```

Wire `request()` to controls with stable selectors such as `data-testid="resource-url"` and `data-testid="resource-request"`. Expose result through stable DOM state. Do not inspect runtime-private objects or application-framework state.

## 2. Load test napplet through real shell

Add test napplet to shell's local registry and expose test-only route that grants declared domains. Keep route out of production registry and navigation.

Browser automation should locate iframe and enter its browsing context. Example API varies by runner:

```js
const iframe = await page.waitForSelector('iframe[title="Resource test napplet"]');
const frame = await iframe.contentFrame();
assert.ok(frame);
```

Do not invoke napplet functions directly through page-evaluation hooks. Drive visible controls or documented protocol entry points so application and runtime seam remain covered.

## 3. Start controlled HTTP fixture server

Start local HTTP server on loopback and unused configurable port. Launch it with shell test environment and close it in unconditional teardown.

Useful routes:

```text
/png-wrong-type       valid PNG bytes, Content-Type: text/plain
/text-as-image        text bytes, Content-Type: image/png
/echo-request         echoes selected request headers and method
/redirect-image       redirect to /png-wrong-type
/oversized-declared   Content-Length above shell limit
/oversized-stream     chunked body crossing shell limit
/slow                 response delayed beyond shell timeout
/svg                  small valid SVG
/status/404           HTTP 404
/counted              valid bytes while recording active count
```

Use fixed bytes. Do not depend on public servers, DNS, production media hosts, relay servers, or internet availability.

Record server observations:

```js
const observations = [];

server.on('request', (request, response) => {
  observations.push({
    url: request.url,
    method: request.method,
    cookie: request.headers.cookie ?? '',
    authorization: request.headers.authorization ?? '',
    referer: request.headers.referer ?? '',
  });

  // Return selected fixture.
});
```

Reset observations before every test. Assert both server observations and napplet-visible result.

## 4. Build browser helper

Create helper that opens test route, fills controls, submits request, and waits for new result:

```js
async function requestResource(page, url) {
  const iframe = await page.waitForSelector('iframe[title="Resource test napplet"]');
  const frame = await iframe.contentFrame();
  assert.ok(frame);

  await frame.waitForSelector('[data-testid="resource-url"]');
  await frame.$eval('[data-testid="resource-url"]', (input) => (input.value = ''));
  await frame.type('[data-testid="resource-url"]', url);
  await frame.click('[data-testid="resource-request"]');
  await frame.waitForFunction(() => Boolean(document.body.dataset.result));

  return frame.evaluate(() => JSON.parse(document.body.dataset.result));
}
```

Adapt syntax to chosen browser runner. Clear result synchronously when request begins. Prefer fresh page per test, or add explicit request correlation, so late completion cannot satisfy wrong assertion.

## 5. Test published shell contract

Expected values must come from shell's documented configuration, not constants copied from another project.

### Supported and rejected schemes

Exercise every scheme shell advertises. Assert unsupported scheme is rejected before fixture server receives request.

### MIME classification

Return known image bytes under misleading `Content-Type`. If shell contract promises byte sniffing, assert returned blob type follows bytes:

```js
const result = await requestResource(page, `${resourceBaseUrl}/png-wrong-type`);
assert.equal(result.ok, true);
assert.equal(result.type, 'image/png');
```

Return plain text labeled as image and assert shell does not forward false image classification.

### Request privacy options

If shell contract promises omitted credentials or referrer, set cookie for fixture origin, request `/echo-request`, then assert server observations:

```js
assert.equal(observation.cookie, '');
assert.equal(observation.authorization, '');
assert.equal(observation.referer, '');
```

These assertions verify real browser behavior rather than fetch-mock options.

### Redirect policy

Request `/redirect-image`. Assert behavior matches documented redirect policy. When redirects are followed, confirm server saw both redirect and target, and final bytes passed all validation.

### Declared size limit

Return `Content-Length` above advertised maximum without full body. Assert rejection. This covers early enforcement.

### Streaming size limit

Send chunked data until total crosses maximum. Assert rejection. This covers missing or dishonest `Content-Length`.

### Timeout

Delay `/slow` beyond advertised timeout and assert rejection. Keep one full integration test even if it costs real timeout duration. Fast unit tests can use injected shorter timeout.

### Media transformations or rejection

Test formats shell treats specially, such as SVG. Assert actual published contract: rejection, sanitization, rasterization, or pass-through. Do not assume all shells choose same behavior.

### HTTP failure

Request `/status/404`; assert non-success response does not become successful blob unless shell explicitly documents other behavior.

### Concurrency

Issue more simultaneous requests than shell limit to `/counted`. Server tracks current and maximum active connections. Hold responses until queue forms, then assert observed maximum does not exceed configured limit.

Call `resource.bytes()` directly from test napplet. Higher-level image helpers may impose smaller client queue and hide shell behavior.

### Product UI integration

Add one test against real application napplet:

```js
const image = await frame.waitForSelector('[data-testid="remote-image"]');
assert.match(await image.evaluate((node) => node.src), /^blob:/);
assert.ok(await image.evaluate((node) => node.naturalWidth > 0));
```

This proves UI consumes shell-returned bytes rather than assigning original remote URL.

## 6. Test object-URL cleanup separately

Shell tests and component lifecycle tests answer different questions. In component-level test, spy on `URL.revokeObjectURL` and verify:

- displayed URL revoked when input changes;
- stale completed request revoked immediately;
- current URL revoked on destruction;
- failed request leaves fallback visible;
- old request cannot overwrite newer image.

Component test may mock `resource.bytes()` because subject is URL ownership. Keep at least one browser integration test unmocked.

## 7. Unit-test pure policy helpers

Extract deterministic policy decisions into small functions where practical. Good candidates:

- URL and scheme checks;
- origin grant checks;
- MIME sniffing;
- declared-size validation;
- streaming byte counter;
- redirect decision;
- resource-server candidate filtering.

Use table-driven tests for accepted, rejected, boundary, and malformed inputs. Avoid exporting broad production internals only for tests; isolate pure policy from network orchestration instead.

Browser integration must still cover actual handler wiring and browser fetch semantics.

## 8. Verify error mapping

Assert codes promised to napplets, not internal exception messages. Include cases for policy refusal, timeout, too-large response, unsupported scheme, upstream failure, and cancellation when supported.

If runtime layer normalizes several failures into generic code, document and test that public behavior. Do not assert console text or private error details.

## 9. Keep suite deterministic

- Use loopback fixture server only.
- Generate URLs from configured host and port.
- Use fixed bytes and explicit response timing.
- Reset counters and observations per test.
- Use fresh page or request correlation per case.
- Close pages, contexts, browsers, fixture server, and shell server.
- Abort delayed responses during teardown.
- Never rely on production external services.
- Never publish napplet during testing.

## 10. Integrate with project commands

Keep fast pure tests in normal unit-test command. Put real browser/bridge cases in integration or browser-test command. CI must provide compatible browser and fail on non-zero result.

Example sequence; translate to project package manager and scripts:

```bash
<build-test-napplet>
<start-local-shell-and-fixture-server>
<run-browser-tests>
```

Run napplet conformance separately. It complements shell integration tests; neither replaces other.

## Completion checklist

- Test uses real sandboxed napplet iframe.
- Request crosses real NAP-RESOURCE bridge.
- HTTP endpoint is local and controlled.
- Server observations and napplet result are both asserted.
- Every advertised scheme has coverage.
- MIME behavior matches shell contract.
- credential, referrer, and redirect behavior match shell contract.
- declared and streamed limits are covered.
- timeout is covered.
- special media behavior and HTTP failures are covered.
- concurrency limit is covered without client throttling.
- real UI renders shell-returned resource.
- component tests cover object-URL cleanup and stale results.
- error mapping is asserted by public codes.
- all processes and delayed responses close reliably.
- project unit, integration, browser, and conformance commands pass.
