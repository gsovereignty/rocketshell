import { SERVICE_WORKER_PROTOCOL_VERSION } from "@platform/napplet-gateway";

interface WaitingWorker { postMessage(message: unknown): void }

export interface UpdateActivationOptions {
  readonly activeWindowCount: () => number;
  readonly closeWindows: () => void;
  readonly confirmActivation: () => boolean;
  readonly reload: () => void;
}

export interface UpdateRegistration extends EventTarget {
  readonly waiting: WaitingWorker | null;
  readonly installing: (EventTarget & { readonly state: string }) | null;
}

export interface WorkerContainer extends EventTarget {}

export interface UpdateCoordinator { check(): boolean; close(): void }

export function coordinateServiceWorkerUpdates(
  registration: UpdateRegistration,
  workerContainer: WorkerContainer,
  options: UpdateActivationOptions
): UpdateCoordinator {
  let closed = false;
  let activationRequested = false;

  const requestActivation = (): boolean => {
    const waiting = registration.waiting;
    if (closed || activationRequested || !waiting) return false;
    if (options.activeWindowCount() > 0) {
      if (!options.confirmActivation()) return false;
      options.closeWindows();
    }
    activationRequested = true;
    waiting.postMessage({
      protocolVersion: SERVICE_WORKER_PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      type: "ACTIVATE_UPDATE"
    });
    return true;
  };

  const onControllerChange = (): void => {
    if (activationRequested && !closed) options.reload();
  };
  const onUpdateFound = (): void => {
    const installing = registration.installing;
    if (!installing) return;
    const onStateChange = (): void => {
      if (installing.state !== "installed") return;
      installing.removeEventListener("statechange", onStateChange);
      requestActivation();
    };
    installing.addEventListener("statechange", onStateChange);
  };

  workerContainer.addEventListener("controllerchange", onControllerChange);
  registration.addEventListener("updatefound", onUpdateFound);
  requestActivation();

  return {
    check: requestActivation,
    close() {
      if (closed) return;
      closed = true;
      workerContainer.removeEventListener("controllerchange", onControllerChange);
      registration.removeEventListener("updatefound", onUpdateFound);
    }
  };
}
