import { expect, test } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

declare global {
  interface Window {
    __platformTest?: {
      windows: { listWindowIds(): readonly string[] };
      destroyWindow(windowId: string): void;
      authenticatedWindowIds(): readonly string[];
      telemetrySnapshot(): readonly { name: string; value: number }[];
      dockLaunchers(): Promise<readonly { coordinate: string; dTag: string }[]>;
      connectExtension(): Promise<string>;
      signOut(): void;
    };
  }
}

test("starts under repository subpath and gains service-worker control", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("Rocketshell");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  expect(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/shell/")))).toBe(true);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/shell/service-worker.js"))).toBe(true);
});

test("build contains no root-relative project asset URLs", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const urls = await page.locator("script[src],link[href]").evaluateAll((elements) => elements.map((element) => element.getAttribute("src") ?? element.getAttribute("href")));
  expect(urls.filter(Boolean).every((url) => url!.startsWith("/shell/") || url!.startsWith("./"))).toBe(true);
});

test("isolates package, public event, and private account persistence", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));
  expect(names).toEqual(expect.arrayContaining(["napplet-packages", "platform-events", "platform-private", "platform-metadata"]));
  expect(new Set(names).size).toBe(names.length);
  const metadata = await page.evaluate(async () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = indexedDB.open("platform-metadata");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("records", "readonly");
      const get = transaction.objectStore("records").get("compatibility");
      get.onerror = () => reject(get.error); get.onsuccess = () => resolve(get.result);
    };
  }));
  expect(metadata).toMatchObject({ profile: "platform-nap-v1", schemaVersions: { metadata: 1, packages: 1, privateAccounts: 1 } });
});

test("runs verified fixture as opaque network-isolated Napplet", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#fixture-status")).toHaveText("ready");
  const dataset = await frame.locator("html").evaluate((element) => ({ ...element.dataset }));
  expect(dataset.resourceError).toBe("");
  expect(dataset).toMatchObject({ origin: "null", nostr: "undefined", storageBlocked: "true", persistenceSealed: "true", hostDomBlocked: "true", fetchBlocked: "true", websocketBlocked: "true", relayQueried: "true", resourceFetched: "true", resourceObjectUrl: "true", resourceRevoked: "true", pubkey: "", intentReceived: "true", intentStructured: "true", platformProfile: "true", optionalAbsent: "true" });
  expect(await page.locator("iframe").getAttribute("data-virtual-url")).toMatch(/^\/shell\/__napplet__\/platform-fixture\/[a-f0-9]{64}\/index\.html$/);
  expect(await page.evaluate(() => window.__platformTest?.telemetrySnapshot().some((record) => record.name === "window.active" && record.value === 1))).toBe(true);
});

test("fetches resource bytes through the sandbox bridge", async ({ page, context }) => {
  const resourceUrl = "http://127.0.0.1:4173/shell/resource-test.png";
  const requests: { method: string; authorization: string; cookie: string; referer: string }[] = [];
  page.on("request", (request) => {
    if (request.url() !== resourceUrl) return;
    const headers = request.headers();
    requests.push({
      method: request.method(),
      authorization: headers.authorization ?? "",
      cookie: headers.cookie ?? "",
      referer: headers.referer ?? ""
    });
  });
  await context.addCookies([{ name: "resource-test", value: "secret", url: "http://127.0.0.1:4173" }]);
  await page.goto("./");

  const frame = page.frameLocator('iframe[title="platform-fixture"]');
  await expect(frame.locator("#fixture-status")).toHaveText("ready");
  await frame.getByTestId("resource-url").fill(resourceUrl);
  await frame.getByTestId("resource-request").click();

  await expect.poll(async () => frame.locator("body").getAttribute("data-resource-result")).not.toBe("");
  const result = JSON.parse((await frame.locator("body").getAttribute("data-resource-result")) ?? "null");
  expect(result).toEqual({ ok: true, type: "image/png", size: 8, firstBytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] });
  expect(requests.at(-1)).toEqual({ method: "GET", authorization: "", cookie: "", referer: "" });
});

test("moves widgets by toolbar drag and keeps resize handles independent", async ({ page }) => {
  await page.goto("./");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  await page.locator("#windows").evaluate((windows) => {
    const widget = document.createElement("article");
    widget.id = "drag-fixture";
    widget.className = "napplet-window";
    widget.innerHTML = '<header class="napplet-window-toolbar"><span class="napplet-window-title">Drag fixture</span></header><div></div>';
    windows.append(widget);
  });
  const first = page.locator(".napplet-window").first();
  const second = page.locator("#drag-fixture");
  await expect(second.locator(".napplet-resize-both")).toBeVisible();
  const firstColumn = await first.evaluate((element) => element.style.gridColumn);
  const secondColumn = await second.evaluate((element) => element.style.gridColumn);
  const firstToolbar = first.locator(".napplet-window-toolbar");
  const secondToolbar = second.locator(".napplet-window-toolbar");
  const from = await firstToolbar.boundingBox();
  const to = await secondToolbar.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + 20, from!.y + from!.height / 2);
  await page.mouse.down();
  await expect(page.locator("#windows")).toHaveAttribute("data-interacting", "move");
  await expect(page.locator("#windows iframe")).toHaveCSS("pointer-events", "none");
  await page.mouse.move(to!.x + 20, to!.y + to!.height / 2, { steps: 4 });
  const previews = page.locator(".napplet-pack-preview");
  await expect(previews).toHaveCount(2);
  await expect(previews.filter({ hasText: "Drag fixture" })).toHaveAttribute("data-placement", "swap");
  await expect(previews.filter({ hasText: "Platform Fixture" })).toHaveAttribute("data-placement", "swap");
  await page.mouse.up();
  await expect(previews).toHaveCount(0);
  await expect.poll(() => first.evaluate((element) => (element as HTMLElement).style.gridColumn)).toBe(secondColumn);
  await expect.poll(() => second.evaluate((element) => (element as HTMLElement).style.gridColumn)).toBe(firstColumn);

  const movedFirstColumn = await first.evaluate((element) => element.style.gridColumn);
  const movedSecondColumn = await second.evaluate((element) => element.style.gridColumn);
  await page.locator("#windows").evaluate((windows) => {
    const widget = document.createElement("article");
    widget.id = "new-fixture";
    widget.className = "napplet-window";
    widget.innerHTML = '<header class="napplet-window-toolbar"><span class="napplet-window-title">New fixture</span></header><div></div>';
    windows.append(widget);
  });
  await expect(page.locator("#new-fixture .napplet-resize-both")).toBeVisible();
  await expect(first).toHaveCSS("grid-column", "3 / span 2");
  await expect(second).toHaveCSS("grid-column", "1 / span 2");
  expect(await first.evaluate((element) => element.style.gridColumn)).toBe(movedFirstColumn);
  expect(await second.evaluate((element) => element.style.gridColumn)).toBe(movedSecondColumn);

  const leftResizeHandle = first.locator(".napplet-resize-inline-start");
  await expect(leftResizeHandle).toHaveCSS("cursor", "ew-resize");
  const leftHandleBounds = await leftResizeHandle.boundingBox();
  const gridStep = await page.locator("#windows").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const gap = Number.parseFloat(styles.columnGap) || 0;
    return (bounds.width - gap * 3) / 4 + gap;
  });
  expect(leftHandleBounds).not.toBeNull();
  await page.waitForTimeout(300);
  await leftResizeHandle.hover({ position: { x: 2, y: 60 } });
  await page.mouse.down();
  await expect(page.locator("#windows")).toHaveAttribute("data-interacting", "resize");
  await page.mouse.move(leftHandleBounds!.x - gridStep + 2, leftHandleBounds!.y + 60);
  await page.mouse.up();
  await expect.poll(() => first.evaluate((element) => element.style.gridColumn)).toBe("2 / span 3");
  await expect.poll(() => second.evaluate((element) => element.style.gridColumn)).toBe("1 / span 1");

  const resizeHandle = second.locator(".napplet-resize-inline");
  await page.waitForTimeout(300);
  await resizeHandle.hover({ position: { x: 2, y: 30 } });
  await page.mouse.down();
  await expect(page.locator("#windows")).toHaveAttribute("data-interacting", "resize");
  await page.mouse.up();
  await expect(page.locator("#windows")).not.toHaveAttribute("data-interacting");

  const persistedFirstColumn = await first.evaluate((element) => element.style.gridColumn);
  await page.reload();
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  await expect.poll(() => page.locator(".napplet-window").first().evaluate((element) => element.style.gridColumn)).toBe(persistedFirstColumn);
});

test("restores saved geometry when only one window is open", async ({ page }) => {
  await page.goto("./");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  await page.evaluate(() => {
    localStorage.setItem("shell.widget-layout.v1", JSON.stringify({
      version: 1,
      profiles: {
        laptop: {
          "platform-fixture#0": { column: 1, row: 1, width: 2, height: 1 }
        }
      }
    }));
  });

  await page.reload();

  const window = page.locator(".napplet-window").first();
  await expect(window).toHaveCSS("grid-column", "2 / span 2");
  await expect(window).toHaveCSS("grid-row", "2 / span 1");
});

test("settles intent result before caller navigation unmounts it", async ({ page }) => {
  await page.goto("./");
  const frame = page.frameLocator('iframe[title="platform-fixture"]');
  await expect(frame.locator("#fixture-status")).toHaveText("ready");
  const result = page.evaluate(() => new Promise<unknown>((resolve) => {
    const listener = (event: MessageEvent): void => {
      if (event.data?.type !== "platform-test.intent-before-navigation") return;
      window.removeEventListener("message", listener);
      resolve(event.data.result);
    };
    window.addEventListener("message", listener);
  }));
  await frame.locator("html").evaluate(() => {
    void window.napplet.intent.invoke({
      archetype: "fixture", action: "open", convention: "napplet:fixture/open", payload: { navigation: true }
    }).then((intentResult) => {
      parent.postMessage({ type: "platform-test.intent-before-navigation", result: intentResult }, "*");
      location.replace("about:blank");
    });
  });
  await expect(result).resolves.toMatchObject({
    ok: true, handled: true, archetype: "fixture", action: "open", handler: "platform-fixture"
  });
  await expect.poll(() => page.frames().some((candidate) => candidate !== page.mainFrame() && candidate.url() === "about:blank")).toBe(true);
});

test("restores intent-created problem window with its tree caller", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await page.getByRole("button", { name: "Open Navigate Problem Tree" }).click();
  const tree = page.frameLocator('iframe[title="navigate-problem-tree"]');
  await expect(tree.locator("#app")).toBeVisible();

  const result = await tree.locator("html").evaluate(async () => window.napplet.intent.invoke({
    archetype: "note", action: "open", convention: "napplet:note/open",
    payload: { target: { type: "event", id: "0".repeat(64) } },
    behavior: { focus: true, reuse: true }
  }));
  expect(result).toMatchObject({ ok: true, handled: true, handler: "view-problem" });
  await expect(page.locator('iframe[title="view-problem"]')).toHaveCount(1);
  const problem = page.frameLocator('iframe[title="view-problem"]');
  await expect(problem.locator("#setup-status")).toHaveText("Selected problem revision was not found.");
  await expect.poll(() => page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("shell.window-session.v2") ?? "null");
    return session?.windows?.map((window: { dTag: string }) => window.dTag);
  })).toEqual(["navigate-problem-tree", "view-problem"]);

  await page.reload();

  await expect(page.locator('iframe[title="navigate-problem-tree"]')).toHaveCount(1);
  await expect(page.locator('iframe[title="view-problem"]')).toHaveCount(1);
  await expect(page.locator('iframe[title="navigate-problem-tree"]').locator("..")).toBeHidden();
  await expect(page.locator('iframe[title="view-problem"]').locator("..")).toBeVisible();
  await expect(page.frameLocator('iframe[title="view-problem"]').locator("#setup-status"))
    .toHaveText("Selected problem revision was not found.");
  expect(await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("shell.window-session.v2") ?? "null");
    return session?.windows?.find((window: { dTag: string }) => window.dTag === "view-problem")?.launch;
  })).toMatchObject({
    type: "intent", sender: "navigate-problem-tree", convention: "napplet:note/open",
    payload: { target: { type: "event", id: "0".repeat(64) } }
  });
});

test("never exposes an empty white Napplet frame during startup", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await page.evaluate(() => {
    const samples: Array<{ title: string; visible: boolean; content: string }> = [];
    const windows = document.querySelector("#windows");
    if (!windows) throw new Error("Napplet window container is missing");
    new MutationObserver((records, observer) => {
      for (const record of records) for (const added of record.addedNodes) {
        if (!(added instanceof HTMLElement) || !added.classList.contains("napplet-window")) continue;
        const frame = added.querySelector("iframe");
        samples.push({
          title: frame?.title ?? "",
          visible: !added.hidden && getComputedStyle(added).display !== "none",
          content: frame?.contentDocument?.body?.textContent?.trim() ?? ""
        });
        if (frame?.title === "view-problem") observer.disconnect();
      }
    }).observe(windows, { childList: true });
    (window as unknown as { __startupFrameSamples: typeof samples }).__startupFrameSamples = samples;
  });

  await page.evaluate(async () => {
    const platform = window.__platformTest as unknown as { openInstalled(dTag: string): Promise<unknown> };
    await platform.openInstalled("view-problem");
  });

  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __startupFrameSamples?: Array<{ title: string }> }).__startupFrameSamples
      ?.some(({ title }) => title === "view-problem") ?? false
  )).toBe(true);
  expect(await page.evaluate(() =>
    (window as unknown as { __startupFrameSamples: Array<{ title: string; visible: boolean; content: string }> })
      .__startupFrameSamples.find(({ title }) => title === "view-problem")
  )).not.toMatchObject({ visible: true, content: "" });
});

test("renders Problem View before identity initialization settles", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __blockedProblemIdentity: boolean }).__blockedProblemIdentity = false;
    window.addEventListener("message", (event) => {
      if (event.data?.type !== "identity.getPublicKey") return;
      const problemFrame = [...document.querySelectorAll<HTMLIFrameElement>("iframe")]
        .find((frame) => frame.title === "view-problem");
      if (!problemFrame || event.source !== problemFrame.contentWindow) return;
      event.stopImmediatePropagation();
      (window as unknown as { __blockedProblemIdentity: boolean }).__blockedProblemIdentity = true;
    }, { capture: true });
  });
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");

  const opening = page.evaluate(async () => {
    const platform = window.__platformTest as unknown as { openInstalled(dTag: string): Promise<unknown> };
    return platform.openInstalled("view-problem");
  });
  await expect(opening).resolves.toBeDefined();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __blockedProblemIdentity: boolean }).__blockedProblemIdentity
  )).toBe(true);

  await expect(page.frameLocator('iframe[title="view-problem"]').locator("#app"))
    .not.toBeEmpty();
});

test("mediates Blossom upload without exposing signer or server selection", async ({ page }) => {
  // The shell reads its media servers from the settings store, so point it at the mock server there.
  // Keys left out fall back to the shipped defaults.
  await page.addInitScript(() => {
    localStorage.setItem("platform:settings:v1", JSON.stringify({ backupBlossomServers: ["http://127.0.0.1:4173/mock-blossom"] }));
  });
  const secret = new Uint8Array(32); secret[31] = 7;
  const pubkey = getPublicKey(secret);
  await page.exposeFunction("__platformTestSignEvent", (template: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(template, secret));
  await page.addInitScript((activePubkey) => {
    Object.defineProperty(window, "nostr", { value: {
      getPublicKey: async () => activePubkey,
      signEvent: (template: { kind: number; created_at: number; content: string; tags: string[][] }) => (window as unknown as { __platformTestSignEvent(value: typeof template): Promise<unknown> }).__platformTestSignEvent(template)
    }, configurable: true });
  }, pubkey);
  await page.goto("./");
  await expect(page.frameLocator('iframe[title="platform-fixture"]').locator("#fixture-status")).toHaveText("ready");
  await page.evaluate(() => window.__platformTest?.connectExtension());
  await expect(page.frameLocator('iframe[title="platform-fixture"]').locator("html")).toHaveAttribute("data-identity-latest", pubkey);
  const result = await page.frameLocator('iframe[title="platform-fixture"]').locator("html").evaluate(async () => {
    const value = await window.napplet.upload.upload({ data: new Blob(["host-owned upload"], { type: "text/plain" }), rail: "blossom", filename: "proof.txt", mimeType: "text/plain" });
    return {
      ok: value.ok, rail: value.rail, url: value.url, size: value.size, error: value.error,
      signer: typeof window.nostr,
      rawFetchServerKnown: document.documentElement.innerHTML.includes("mock-blossom")
    };
  });
  expect(result).toEqual({
    ok: true, rail: "blossom", url: `https://cdn.example/${pubkey}/uploaded.txt`, size: 17, error: undefined,
    signer: "undefined", rawFetchServerKnown: false
  });
  await page.evaluate(() => window.__platformTest?.signOut());
  await expect(page.frameLocator('iframe[title="platform-fixture"]').locator("html")).toHaveAttribute("data-identity-latest", "");
  expect(Number(await page.frameLocator('iframe[title="platform-fixture"]').locator("html").getAttribute("data-identity-changes"))).toBeGreaterThanOrEqual(2);
});

test("invalidates in-flight signing and pushes an account switch", async ({ page }) => {
  const firstSecret = new Uint8Array(32); firstSecret[31] = 8;
  const secondSecret = new Uint8Array(32); secondSecret[31] = 9;
  let activeSecret = firstSecret;
  let releaseSigning: (() => void) | undefined;
  let signingStarted: (() => void) | undefined;
  const signingGate = new Promise<void>((resolve) => { releaseSigning = resolve; });
  const started = new Promise<void>((resolve) => { signingStarted = resolve; });
  await page.exposeFunction("__platformTestPublicKey", () => getPublicKey(activeSecret));
  await page.exposeFunction("__platformTestDelayedSign", async (template: Parameters<typeof finalizeEvent>[0]) => {
    const operationSecret = activeSecret;
    signingStarted?.();
    await signingGate;
    return finalizeEvent(template, operationSecret);
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "nostr", { value: {
      getPublicKey: () => (window as unknown as { __platformTestPublicKey(): Promise<string> }).__platformTestPublicKey(),
      signEvent: (template: { kind: number; created_at: number; content: string; tags: string[][] }) => (window as unknown as { __platformTestDelayedSign(value: typeof template): Promise<unknown> }).__platformTestDelayedSign(template)
    }, configurable: true });
  });
  await page.goto("./");
  const frame = page.frameLocator('iframe[title="platform-fixture"]');
  await expect(frame.locator("#fixture-status")).toHaveText("ready");
  await page.evaluate(() => window.__platformTest?.connectExtension());
  await expect(frame.locator("html")).toHaveAttribute("data-identity-latest", getPublicKey(firstSecret));
  await frame.locator("html").evaluate((element) => {
    void window.napplet.upload.upload({ data: new Blob(["pending"]), rail: "blossom" }).then((result) => {
      element.dataset.pendingUpload = result.ok ? "unexpected-success" : "invalidated";
    });
  });
  await started;
  await page.evaluate(() => window.__platformTest?.signOut());
  releaseSigning?.();
  await expect(frame.locator("html")).toHaveAttribute("data-pending-upload", "invalidated");
  activeSecret = secondSecret;
  await page.evaluate(() => window.__platformTest?.connectExtension());
  await expect(frame.locator("html")).toHaveAttribute("data-identity-latest", getPublicKey(secondSecret));
  expect(Number(await frame.locator("html").getAttribute("data-identity-changes"))).toBeGreaterThanOrEqual(3);
});

test("rejects shell messages from an unregistered source window", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const receivedInit = await page.evaluate(async () => {
    const probe = document.createElement("iframe");
    probe.setAttribute("sandbox", "allow-scripts");
    probe.srcdoc = `<script>let gotInit=false;addEventListener('message',e=>{if(e.data?.type==='shell.init')gotInit=true});parent.postMessage({type:'shell.ready'},'*');setTimeout(()=>parent.postMessage({type:'probe.result',gotInit},'*'),200)</script>`;
    const result = new Promise<boolean>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.source !== probe.contentWindow || event.data?.type !== "probe.result") return;
        window.removeEventListener("message", listener);
        resolve(Boolean(event.data.gotInit));
      };
      window.addEventListener("message", listener);
    });
    document.body.append(probe);
    const received = await result;
    probe.remove();
    return received;
  });
  expect(receivedInit).toBe(false);
});

test("reloads shell and verified Napplet while offline", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "Playwright WebKit offline reload is unsupported");
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
});

test("closing a Napplet removes its window and authenticated session", async ({ page }) => {
  await page.goto("./");
  await expect(page.frameLocator("iframe").locator("#fixture-status")).toHaveText("ready");
  const before = await page.evaluate(() => ({
    managed: window.__platformTest?.windows.listWindowIds() ?? [],
    authenticated: window.__platformTest?.authenticatedWindowIds() ?? []
  }));
  expect(before.managed).toHaveLength(1);
  expect(before.authenticated).toEqual(before.managed);
  await page.getByRole("button", { name: "Close Platform Fixture" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(await page.evaluate(() => window.__platformTest?.windows.listWindowIds())).toEqual([]);
  expect(await page.evaluate(() => window.__platformTest?.authenticatedWindowIds())).toEqual([]);
});

test("coordinate loader reports malformed input without opening a window", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const spotlight = page.getByRole("button", { name: "Open Napplet Spotlight" });
  await spotlight.click();
  await expect(spotlight).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#coordinate")).toBeVisible();
  await page.locator("#coordinate").fill("not-a-coordinate");
  const openButton = page.getByRole("button", { name: "Open Napplet", exact: true });
  await expect(openButton).toBeEnabled();
  await openButton.click();
  await expect(page.locator("#loader-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#loader-status")).toHaveText("Use naddr or kind:pubkey:identifier");
  await expect(page.locator("#coordinate")).toHaveValue("not-a-coordinate");
  await expect(page.locator("#windows iframe")).toHaveCount(1);
});

test("coordinate loader animates pending work", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await page.evaluate(() => {
    const platform = window.__platformTest as unknown as {
      installAndOpen(coordinate: string): Promise<{ dTag: string; title: string; windowId: string }>;
    };
    let opened = 0;
    platform.installAndOpen = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      opened += 1;
      return { dTag: "animated-fixture", title: "Animated Fixture", windowId: `animated-window-${opened}` };
    };
  });
  await page.getByRole("button", { name: "Open Napplet Spotlight" }).click();
  await page.locator("#coordinate").fill("35129:fixture:animated");
  await page.getByRole("button", { name: "Open Napplet", exact: true }).click();
  await expect(page.locator("#loader-status")).toHaveAttribute("data-state", "busy");
  await expect(page.locator("#loader-progress")).toHaveCSS("opacity", "1");
  await expect(page.locator("#loader-status")).toHaveText("Opened Animated Fixture.");
  await expect(page.locator("#coordinate")).toHaveValue("");
  await expect(page.locator("#spotlight-panel")).toBeHidden();
  await page.getByRole("button", { name: "Open Napplet Spotlight" }).click();
  await page.locator("#coordinate").fill("35129:fixture:second");
  await page.getByRole("button", { name: "Open Napplet", exact: true }).click();
  await expect(page.locator("#loader-status")).toHaveText("Opened Animated Fixture.");
});

test("refresh restores open installed napplets", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const coordinate = await page.evaluate(async () => (await window.__platformTest?.dockLaunchers())?.find((launcher) => launcher.dTag === "log-new-problem")?.coordinate);
  await page.evaluate((value) => localStorage.setItem("shell.pinned-napplets", JSON.stringify([value])), coordinate);
  await page.reload();
  await page.getByRole("button", { name: "Open Log New Problem" }).click();
  await expect(page.locator(".napplet-window")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("shell.window-session.v2"))).not.toBeNull();

  await page.reload();
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await expect(page.locator(".napplet-window")).toHaveCount(2);
});

test("refresh migrates legacy dock state without relay discovery", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const coordinate = await page.evaluate(async () => (await window.__platformTest?.dockLaunchers())?.find((launcher) => launcher.dTag === "log-new-problem")?.coordinate);
  await page.evaluate((value) => localStorage.setItem("shell.pinned-napplets", JSON.stringify([value])), coordinate);
  await page.reload();
  await page.getByRole("button", { name: "Open Log New Problem" }).evaluate((button) => {
    button.click();
    return new Promise<string>((resolve) => {
      const poll = (): void => {
        const saved = JSON.parse(localStorage.getItem("shell.window-session.v2") ?? "null") as { windows?: { launch?: { coordinate?: string } }[] } | null;
        const coordinate = saved?.windows?.[0]?.launch?.coordinate;
        if (coordinate) resolve(coordinate);
        else setTimeout(poll, 10);
      };
      poll();
    });
  });
  await page.evaluate((savedCoordinate) => localStorage.setItem("shell.open-napplets", JSON.stringify([savedCoordinate])), coordinate);

  await page.reload();
  await expect(page.locator(".napplet-window")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shell.window-session.v2") ?? "null")?.windows?.[0]?.dTag)).toBe("log-new-problem");
});

test("menu bar exposes account and Spotlight controls", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  const profile = page.locator("#profile-menu-trigger");
  await expect(profile.locator("#profile-avatar-fallback")).toHaveText("R");
  await profile.click();
  await expect(page.locator("#account-popover")).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile (coming soon)" })).toBeVisible();
  await page.locator("#connect-account").evaluate((element) => { (element as HTMLButtonElement).hidden = true; });
  await page.locator("#sign-out").evaluate((element) => { (element as HTMLButtonElement).hidden = false; });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#account-popover")).toBeHidden();
  const spotlight = page.getByRole("button", { name: "Open Napplet Spotlight" });
  await spotlight.click();
  await expect(page.locator("#spotlight-panel")).toBeVisible();
  await expect(page.locator("#coordinate")).toBeVisible();
  await spotlight.click();
  await expect(page.locator("#spotlight-panel")).toBeHidden();
});

test("preferences panel themes the shell and edits the local relay list", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText("Platform ready");
  await page.locator("#profile-menu-trigger").click();
  await page.getByRole("button", { name: "Preferences" }).click();
  await expect(page.locator("#settings-panel")).toBeVisible();
  await expect(page.locator("#account-popover")).toBeHidden();

  await expect(page.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("tab", { name: "Relays" }).click();
  await expect(page.getByText("Connect an identity to see and edit this list.")).toBeVisible();
  const backup = page.getByLabel("Add to backup relays");
  await backup.fill("http://insecure.example.com");
  await backup.press("Enter");
  await expect(page.getByText("Relay scheme forbidden")).toBeVisible();
  await backup.fill("wss://added.example.com");
  await backup.press("Enter");
  await expect(page.getByText("wss://added.example.com/", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-panel")).toBeHidden();

  // Both the theme and the relay edit are persisted, not just held in memory.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#profile-menu-trigger").click();
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByRole("tab", { name: "Relays" }).click();
  await expect(page.getByText("wss://added.example.com/", { exact: true })).toBeVisible();
});

test("dock introduces itself then returns at bottom edge", async ({ page }) => {
  await page.goto("./");
  const dock = page.locator("#dock-shell");
  await expect(dock).toHaveAttribute("data-visible", "true");
  await expect(dock).toHaveCSS("opacity", "1");
  await expect(dock).toHaveAttribute("data-visible", "false", { timeout: 5_000 });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true, clientX: innerWidth / 2, clientY: innerHeight - 30
  })));
  await expect(dock).toHaveAttribute("data-visible", "true");
  await expect(dock).toHaveCSS("opacity", "1");
});

test("dock opens an active Napplet without relay discovery", async ({ page }) => {
  await page.goto("./");
  const launcher = page.getByRole("button", { name: "Open Platform Fixture" });
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.locator('iframe[title="platform-fixture"]')).toHaveCount(2);
  await expect(page.locator("#loader-status")).toHaveText("Opened Platform Fixture.");
});

test("dock always includes built-in Napplets", async ({ page }) => {
  await page.goto("./");
  const launcher = page.getByRole("button", { name: "Open Log New Problem" });
  await expect(launcher).toBeVisible();
  await expect(launcher.locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Navigate Problem Tree" }).locator("img")).toBeVisible();
  await expect(page.locator('iframe[title="log-new-problem"]')).toHaveCount(0);
  await launcher.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Log New Problem is built in to Rocketshell" })).toBeDisabled();
});

test("dock icon override persists and can be reset", async ({ page }) => {
  await page.goto("./");
  let launcher = page.getByRole("button", { name: "Open Log New Problem" });
  await launcher.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Change Log New Problem icon" }).click();

  const editor = page.getByRole("dialog", { name: "Change Log New Problem icon" });
  await editor.getByRole("textbox", { name: "Icon letters" }).fill("rs");
  await editor.getByRole("button", { name: "Use Letters" }).click();
  await expect(launcher.locator(".dock-initial")).toHaveText("RS");

  await page.reload();
  launcher = page.getByRole("button", { name: "Open Log New Problem" });
  await expect(launcher.locator(".dock-initial")).toHaveText("RS");
  await launcher.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reset Log New Problem to Napplet icon" }).click();
  await expect(launcher.locator("img")).toBeVisible();
});

test("dock context menu pins an open Napplet and removes it after close", async ({ page }) => {
  await page.goto("./");
  const launcher = page.getByRole("button", { name: "Open Platform Fixture" });
  await expect(launcher.locator(".dock-initial")).toHaveText("P");

  await launcher.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Keep Platform Fixture in Dock" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shell.pinned-napplets") ?? "[]").length)).toBe(1);

  await page.locator(".napplet-window-close").click();
  await expect(launcher).toBeVisible();
  await expect(launcher.locator(".dock-running-indicator")).toBeHidden();

  await page.evaluate(() => document.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true, clientX: innerWidth / 2, clientY: innerHeight - 20
  })));
  await launcher.dispatchEvent("contextmenu", { clientX: 200, clientY: 700 });
  await page.getByRole("menuitem", { name: "Remove Platform Fixture from Dock" }).click();
  await expect(launcher).toBeHidden();
});
