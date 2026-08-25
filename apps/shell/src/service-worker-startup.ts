import { SERVICE_WORKER_PROTOCOL_VERSION } from "@platform/napplet-gateway";

interface StartupWorker extends EventTarget {
  readonly state: string;
  postMessage(message: unknown): void;
}

export interface StartupRegistration {
  readonly active: unknown | null;
  readonly waiting: StartupWorker | null;
  readonly installing: StartupWorker | null;
  update(): Promise<unknown>;
}

export interface StartupWorkerContainer extends EventTarget {
  readonly controller: unknown | null;
  readonly ready: Promise<unknown>;
}

const successfulInstallStates = new Set(["installed", "activated"]);

const waitForInstallation = async (worker: StartupWorker | null): Promise<void> => {
  if (!worker) return;
  if (worker.state === "redundant") throw new Error("Service worker update became redundant");
  if (successfulInstallStates.has(worker.state)) return;
  await new Promise<void>((resolve, reject) => {
    const onStateChange = (): void => {
      if (worker.state === "redundant") {
        worker.removeEventListener("statechange", onStateChange);
        reject(new Error("Service worker update became redundant"));
        return;
      }
      if (!successfulInstallStates.has(worker.state)) return;
      worker.removeEventListener("statechange", onStateChange);
      resolve();
    };
    worker.addEventListener("statechange", onStateChange);
  });
};

const waitForControllerChange = (container: StartupWorkerContainer, timeoutMs: number): Promise<void> => new Promise((resolve, reject) => {
  const timeout = globalThis.setTimeout(() => {
    container.removeEventListener("controllerchange", onControllerChange);
    reject(new Error("Service worker activation timed out"));
  }, timeoutMs);
  const onControllerChange = (): void => {
    globalThis.clearTimeout(timeout);
    resolve();
  };
  container.addEventListener("controllerchange", onControllerChange, { once: true });
});

/** Establishes newest worker control before any built-in registry or artifact read. */
export async function settleServiceWorkerStartup(
  registration: StartupRegistration,
  container: StartupWorkerContainer,
  activationTimeoutMs = 10_000
): Promise<"ready" | "reload"> {
  if (!registration.installing && !registration.waiting) {
    try {
      await registration.update();
    } catch (error) {
      if (registration.active === null || container.controller === null) throw error;
      console.warn("Service worker update check failed; continuing with active offline worker", { error });
    }
  }
  await waitForInstallation(registration.installing);

  const waiting = registration.waiting;
  if (waiting) {
    const controllerChanged = waitForControllerChange(container, activationTimeoutMs);
    waiting.postMessage({
      protocolVersion: SERVICE_WORKER_PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      type: "ACTIVATE_UPDATE"
    });
    await controllerChanged;
    return "reload";
  }

  await container.ready;
  return container.controller === null ? "reload" : "ready";
}
