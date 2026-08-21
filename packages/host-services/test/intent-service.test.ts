import type { Runtime, ServiceHandler, ServiceRuntimeContext } from "@kehto/runtime";
import type { PackageStore, NappletWindowManager, WindowLaunchDescriptor } from "@platform/napplet-gateway";
import { describe, expect, it, vi } from "vitest";
import { registerIntentService } from "../src/index.js";

function setup(options: Parameters<typeof registerIntentService>[3] = {}) {
  let handler: ServiceHandler | undefined;
  const runtime = { registerService: (_name: string, value: ServiceHandler) => { handler = value; } } as unknown as Runtime;
  const source = { postMessage: vi.fn() };
  const target = {
    identity: { dTag: "viewer-app", windowId: "target-1", source }, iframe: { focus: vi.fn() },
    ready: Promise.resolve(), launch: undefined as WindowLaunchDescriptor | undefined
  };
  const caller = { identity: { dTag: "runtime-attested-sender", windowId: "caller-1", source: {} } };
  const windows = {
    findByDTag: vi.fn((dTag: string) => dTag === caller.identity.dTag ? caller : target),
    create: vi.fn(async () => target),
    focus: vi.fn(),
    setLaunchDescriptor: vi.fn()
  } as unknown as NappletWindowManager;
  const store = { listActive: vi.fn(async () => [{
    dTag: "viewer-app", manifest: {
      dTag: "viewer-app", aggregateHash: "a".repeat(64), entrypoint: "index.html", requires: [], artifacts: [],
      archetypes: [{ slug: "viewer", convention: "napplet:viewer/open" }]
    }
  }]) } as unknown as PackageStore;
  registerIntentService(runtime, store, windows, options);
  handler!.onRegistered?.({
    resolveDTag: () => "runtime-attested-sender", listWindowIds: () => ["sender-1"],
    hasCapability: () => true, sendToEligibleNapplet: () => true
  } as ServiceRuntimeContext);
  return { handler: handler!, windows, source, target, caller, store };
}

describe("intent host boundary", () => {
  it("rejects malformed intent before window work", () => {
    const { handler, windows } = setup(); const send = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "bad", request: { archetype: "viewer", forgedSender: "attacker" }
    } as never, send);
    expect(windows.findByDTag).not.toHaveBeenCalled(); expect(windows.create).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "intent.invoke.result", result: expect.objectContaining({ ok: false }) }));
  });

  it("supplies runtime-attested sender to INC delivery", async () => {
    const { handler, windows, source } = setup(); const send = vi.fn();
    (windows.findByDTag as ReturnType<typeof vi.fn>).mockImplementation((dTag: string) =>
      dTag === "runtime-attested-sender"
        ? { identity: { dTag, windowId: "caller-1", source: {} } }
        : undefined);
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "open", request: { archetype: "viewer", payload: { id: 1 } }
    } as never, send);
    await vi.waitFor(() => expect(source.postMessage).toHaveBeenCalled());
    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "inc.event", topic: "napplet:viewer/open", sender: "runtime-attested-sender", payload: { id: 1 }
    }), "*");
    expect(windows.setLaunchDescriptor).toHaveBeenCalledWith("target-1", {
      type: "intent", sender: "runtime-attested-sender", convention: "napplet:viewer/open", payload: { id: 1 }
    });
  });

  it("does not replace direct launch provenance when reusing a target", async () => {
    const { handler, windows, target } = setup(); const send = vi.fn();
    target.launch = { type: "direct", coordinate: "installed-coordinate" };
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "reuse", request: { archetype: "viewer", payload: { id: 2 } }
    } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(windows.setLaunchDescriptor).not.toHaveBeenCalled();
  });

  it("rejects unsupported contracts before window work", async () => {
    const { handler, windows } = setup();
    for (const request of [
      { archetype: "unknown" },
      { archetype: "viewer", action: "edit" },
      { archetype: "viewer", convention: "napplet:viewer/edit" }
    ]) {
      const send = vi.fn();
      handler.handleMessage("sender-1", { type: "intent.invoke", id: "reject", request } as never, send);
      await vi.waitFor(() => expect(send).toHaveBeenCalled());
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: false, handled: false }) }));
    }
    expect(windows.findByDTag).not.toHaveBeenCalled();
    expect(windows.create).not.toHaveBeenCalled();
  });

  it("honors target lifecycle hints without exposing a URL", async () => {
    const { handler, windows } = setup(); const send = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "fresh", request: {
        archetype: "viewer", action: "open", convention: "napplet:viewer/open",
        payload: { id: 2 }, behavior: { newWindow: true, focus: false }
      }
    } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(windows.findByDTag).toHaveBeenCalledWith("runtime-attested-sender");
    expect(windows.findByDTag).not.toHaveBeenCalledWith("viewer-app");
    expect(windows.create).toHaveBeenCalledWith("viewer-app", false, { deferLayout: false });
    expect(windows.focus).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "intent.invoke.result",
      result: expect.objectContaining({ ok: true, handler: "viewer-app", windowId: "target-1" })
    }));
  });

  it("uses the account default before opening among multiple handlers", async () => {
    const getDefaultHandler = vi.fn(() => "alternate-viewer");
    const { handler, windows, store } = setup({ getDefaultHandler });
    (store.listActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      { dTag: "viewer-app", manifest: { dTag: "viewer-app", aggregateHash: "a".repeat(64), entrypoint: "index.html", requires: [], artifacts: [], archetypes: [{ slug: "viewer", convention: "napplet:viewer/open" }] } },
      { dTag: "alternate-viewer", manifest: { dTag: "alternate-viewer", aggregateHash: "b".repeat(64), entrypoint: "index.html", requires: [], artifacts: [], archetypes: [{ slug: "viewer", convention: "napplet:viewer/open" }] } }
    ]);
    const send = vi.fn();
    handler.handleMessage("sender-1", { type: "intent.invoke", id: "default", request: { archetype: "viewer" } } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(getDefaultHandler).toHaveBeenCalledWith("viewer");
    expect(windows.findByDTag).toHaveBeenCalledWith("alternate-viewer");
    expect(windows.focus).toHaveBeenCalledWith("target-1", "caller-1");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: true, handler: "alternate-viewer" }) }));
  });

  it("uses host user choice before opening a requested handler", async () => {
    const chooseHandler = vi.fn(async () => "alternate-viewer");
    const { handler, windows, store } = setup({ chooseHandler });
    (store.listActive as ReturnType<typeof vi.fn>).mockResolvedValue([
      { dTag: "viewer-app", manifest: { dTag: "viewer-app", aggregateHash: "a".repeat(64), entrypoint: "index.html", requires: [], artifacts: [], archetypes: [{ slug: "viewer", convention: "napplet:viewer/open" }] } },
      { dTag: "alternate-viewer", manifest: { dTag: "alternate-viewer", aggregateHash: "b".repeat(64), entrypoint: "index.html", requires: [], artifacts: [], archetypes: [{ slug: "viewer", convention: "napplet:viewer/open" }] } }
    ]);
    const send = vi.fn();
    handler.handleMessage("sender-1", { type: "intent.invoke", id: "choose", request: { archetype: "viewer", handler: "choose" } } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(chooseHandler).toHaveBeenCalledWith("viewer", expect.arrayContaining([
      expect.objectContaining({ dTag: "viewer-app" }), expect.objectContaining({ dTag: "alternate-viewer" })
    ]), "runtime-attested-sender");
    expect(windows.findByDTag).toHaveBeenCalledWith("alternate-viewer");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: true, handler: "alternate-viewer" }) }));
  });

  it("requires host authorization for an explicit handler", async () => {
    const authorizeExplicitHandler = vi.fn(async () => false);
    const { handler, windows } = setup({ authorizeExplicitHandler });
    const send = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "explicit", request: { archetype: "viewer", handler: "viewer-app" }
    } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(authorizeExplicitHandler).toHaveBeenCalledWith("runtime-attested-sender", "viewer-app");
    expect(windows.create).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: false }) }));
  });

  it("dispatches an authorized explicit handler", async () => {
    const authorizeExplicitHandler = vi.fn(async () => true);
    const { handler, windows } = setup({ authorizeExplicitHandler });
    const send = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "explicit-allowed", request: { archetype: "viewer", handler: "viewer-app" }
    } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(authorizeExplicitHandler).toHaveBeenCalledWith("runtime-attested-sender", "viewer-app");
    expect(windows.create).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: true, handler: "viewer-app" }) }));
  });

  it("defers cold target layout and replaces only its caller", async () => {
    const { handler, windows } = setup();
    (windows.findByDTag as ReturnType<typeof vi.fn>).mockImplementation((dTag: string) =>
      dTag === "runtime-attested-sender"
        ? { identity: { dTag, windowId: "caller-1", source: {} } }
        : undefined);
    const send = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "cold-replace", request: { archetype: "viewer" }
    } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(windows.create).toHaveBeenCalledWith("viewer-app", true, { deferLayout: true });
    expect(windows.focus).toHaveBeenCalledWith("target-1", "caller-1");
  });

  it("buffers concurrent cold payloads and delivers each exactly once", async () => {
    const { handler, windows, source, target } = setup();
    let becomeReady: (() => void) | undefined;
    target.ready = new Promise<void>((resolve) => { becomeReady = resolve; });
    (windows.findByDTag as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const firstSend = vi.fn(); const secondSend = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "cold-1", request: { archetype: "viewer", payload: { id: 1 } }
    } as never, firstSend);
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "cold-2", request: { archetype: "viewer", payload: { id: 2 } }
    } as never, secondSend);
    await vi.waitFor(() => expect(windows.create).toHaveBeenCalledTimes(2));
    expect(source.postMessage).not.toHaveBeenCalled();
    becomeReady?.();
    await vi.waitFor(() => expect(source.postMessage).toHaveBeenCalledTimes(2));
    expect(source.postMessage.mock.calls.map(([message]) => message.payload)).toEqual(expect.arrayContaining([{ id: 1 }, { id: 2 }]));
    expect(firstSend).toHaveBeenCalledOnce(); expect(secondSend).toHaveBeenCalledOnce();
  });

  it("returns failure when target disappears before delivery", async () => {
    const { handler, windows, source, target } = setup();
    target.ready = Promise.reject(new Error("window destroyed"));
    const send = vi.fn();
    handler.handleMessage("sender-1", {
      type: "intent.invoke", id: "destroyed", request: { archetype: "viewer", payload: { id: 3 } }
    } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(source.postMessage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ ok: false }) }));
  });
});
