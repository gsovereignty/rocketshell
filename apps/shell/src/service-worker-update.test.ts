import { describe, expect, it, vi } from "vitest";
import { coordinateServiceWorkerUpdates, recordWorkerProtocolFailure, type UpdateRegistration } from "./service-worker-update.js";
import { createPlatformTelemetry } from "@project/platform-nap-contract";

function setup(activeWindows = 0, approve = true) {
  const worker = { postMessage: vi.fn() };
  const registration = Object.assign(new EventTarget(), { waiting: worker, installing: null }) as UpdateRegistration;
  const container = new EventTarget();
  const options = {
    activeWindowCount: vi.fn(() => activeWindows), closeWindows: vi.fn(),
    confirmActivation: vi.fn(() => approve), reload: vi.fn()
  };
  return { worker, registration, container, options };
}

describe("service-worker update coordination", () => {
  it("records only worker protocol failures", () => {
    const telemetry = createPlatformTelemetry();
    expect(recordWorkerProtocolFailure({ ok: false, error: "unsupported-protocol" }, telemetry)).toBe(true);
    expect(recordWorkerProtocolFailure({ ok: true }, telemetry)).toBe(false);
    expect(telemetry.snapshot()).toContainEqual(expect.objectContaining({ name: "protocol.failure", labels: { reason: "unsupported-protocol" } }));
  });
  it("activates immediately when no Napplet window is live", () => {
    const state = setup();
    const coordinator = coordinateServiceWorkerUpdates(state.registration, state.container, state.options);
    expect(state.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ protocolVersion: 1, type: "ACTIVATE_UPDATE" }));
    expect(state.options.confirmActivation).not.toHaveBeenCalled();
    state.container.dispatchEvent(new Event("controllerchange"));
    expect(state.options.reload).toHaveBeenCalledOnce();
    coordinator.close();
  });

  it("preserves active windows when activation is declined", () => {
    const state = setup(1, false);
    const coordinator = coordinateServiceWorkerUpdates(state.registration, state.container, state.options);
    expect(state.worker.postMessage).not.toHaveBeenCalled();
    expect(state.options.closeWindows).not.toHaveBeenCalled();
    expect(state.options.reload).not.toHaveBeenCalled();
    coordinator.close();
  });

  it("destroys active windows before approved activation", () => {
    const state = setup(2, true);
    const coordinator = coordinateServiceWorkerUpdates(state.registration, state.container, state.options);
    expect(state.options.closeWindows).toHaveBeenCalledOnce();
    expect(state.options.closeWindows.mock.invocationCallOrder[0]).toBeLessThan(state.worker.postMessage.mock.invocationCallOrder[0]!);
    coordinator.close();
  });
});
