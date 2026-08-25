import { describe, expect, it, vi } from "vitest";
import { settleServiceWorkerStartup, type StartupRegistration, type StartupWorkerContainer } from "./service-worker-startup.js";

class WorkerState extends EventTarget {
  readonly postMessage = vi.fn((message: any, transfer?: Transferable[]) => {
    if (message.type !== "PING" || !transfer?.[0]) return;
    (transfer[0] as MessagePort).postMessage({ protocolVersion: 1, requestId: message.requestId, buildId: this.buildId, ok: true });
  });
  constructor(public state: string, readonly buildId = "build-current") { super(); }
  move(state: string): void { this.state = state; this.dispatchEvent(new Event("statechange")); }
}

class WorkerContainer extends EventTarget implements StartupWorkerContainer {
  readonly ready = Promise.resolve();
  constructor(public controller: WorkerState | null) { super(); }
}

const registration = (values: Partial<StartupRegistration> = {}): StartupRegistration => ({
  active: {},
  waiting: null,
  installing: null,
  update: vi.fn(async () => undefined),
  ...values
});

describe("service-worker startup settlement", () => {
  it("checks for an update before declaring an active controller current", async () => {
    const state = registration();
    await expect(settleServiceWorkerStartup(state, new WorkerContainer(new WorkerState("activated")), "build-current")).resolves.toBe("ready");
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("waits for a worker created by the explicit update check", async () => {
    let installing: WorkerState | null = null;
    let waiting: WorkerState | null = null;
    const state: StartupRegistration = {
      active: {},
      get waiting() { return waiting; },
      get installing() { return installing; },
      update: vi.fn(async () => {
        installing = new WorkerState("installing");
        queueMicrotask(() => { waiting = installing; installing?.move("installed"); });
      })
    };
    const container = new WorkerContainer(new WorkerState("activated"));
    const settled = settleServiceWorkerStartup(state, container, "build-current");
    await vi.waitFor(() => expect(waiting?.postMessage).toHaveBeenCalledOnce());
    container.dispatchEvent(new Event("controllerchange"));
    await expect(settled).resolves.toBe("reload");
  });

  it("activates a waiting update and requires reload before registry reads", async () => {
    const waiting = new WorkerState("installed");
    const container = new WorkerContainer(new WorkerState("activated"));
    const settled = settleServiceWorkerStartup(registration({ waiting }), container, "build-current");
    await vi.waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ACTIVATE_UPDATE" })));
    container.controller = new WorkerState("activated");
    container.dispatchEvent(new Event("controllerchange"));
    await expect(settled).resolves.toBe("reload");
  });

  it("waits for an in-flight install before activating it", async () => {
    const installing = new WorkerState("installing");
    let waiting: WorkerState | null = null;
    const state: StartupRegistration = {
      active: {},
      get waiting() { return waiting; },
      installing,
      update: vi.fn(async () => undefined)
    };
    const container = new WorkerContainer(new WorkerState("activated"));
    const settled = settleServiceWorkerStartup(state, container, "build-current");
    expect(state.update).not.toHaveBeenCalled();
    waiting = installing;
    installing.move("installed");
    await vi.waitFor(() => expect(installing.postMessage).toHaveBeenCalledOnce());
    container.dispatchEvent(new Event("controllerchange"));
    await expect(settled).resolves.toBe("reload");
  });

  it("requires reload after first registration leaves current page uncontrolled", async () => {
    await expect(settleServiceWorkerStartup(registration({ active: null }), new WorkerContainer(null), "build-current")).resolves.toBe("reload");
  });

  it("continues offline when an active worker already controls the page", async () => {
    const error = new TypeError("offline");
    const state = registration({ update: vi.fn(async () => { throw error; }) });
    await expect(settleServiceWorkerStartup(state, new WorkerContainer(new WorkerState("activated")), "build-current")).resolves.toBe("ready");
  });

  it("propagates update failure when no active worker can support offline startup", async () => {
    const error = new TypeError("offline");
    const state = registration({ active: null, update: vi.fn(async () => { throw error; }) });
    await expect(settleServiceWorkerStartup(state, new WorkerContainer(null), "build-current")).rejects.toBe(error);
  });

  it("rejects an update that becomes redundant instead of using the old controller", async () => {
    const installing = new WorkerState("installing");
    const settled = settleServiceWorkerStartup(registration({ installing }), new WorkerContainer(new WorkerState("activated")), "build-current");
    installing.move("redundant");
    await expect(settled).rejects.toThrow("became redundant");
  });

  it("rejects a waiting worker that never takes control", async () => {
    const waiting = new WorkerState("installed");
    await expect(settleServiceWorkerStartup(registration({ waiting }), new WorkerContainer(new WorkerState("activated")), "build-current", 5))
      .rejects.toThrow("activation timed out");
  });

  it("rejects a stale controller with same protocol before registry reads", async () => {
    const controller = new WorkerState("activated", "build-stale");
    await expect(settleServiceWorkerStartup(registration(), new WorkerContainer(controller), "build-current"))
      .rejects.toThrow("expected build-current, received build-stale");
    expect(controller.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocolVersion: 1, type: "PING" }),
      [expect.any(MessagePort)]
    );
  });
});
