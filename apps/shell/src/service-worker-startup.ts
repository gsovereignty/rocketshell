import { SERVICE_WORKER_PROTOCOL_VERSION, type WorkerReply } from "@platform/napplet-gateway";

interface StartupWorker extends EventTarget {
  readonly state: string;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export interface StartupRegistration {
  readonly active: unknown | null;
  readonly waiting: StartupWorker | null;
  readonly installing: StartupWorker | null;
  update(): Promise<unknown>;
}

export interface StartupWorkerContainer extends EventTarget {
  readonly controller: StartupWorker | null;
  readonly ready: Promise<unknown>;
}

const readBuildIdentity = (worker: StartupWorker, timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
  const channel = new MessageChannel();
  const requestId = crypto.randomUUID();
  const timeout = globalThis.setTimeout(() => {
    channel.port1.close();
    reject(new Error("Service worker identity check timed out"));
  }, timeoutMs);
  channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
    globalThis.clearTimeout(timeout);
    channel.port1.close();
    const reply = event.data;
    if (!reply || reply.ok !== true || reply.protocolVersion !== SERVICE_WORKER_PROTOCOL_VERSION || reply.requestId !== requestId || typeof reply.buildId !== "string") {
      reject(new Error("Service worker returned invalid identity"));
      return;
    }
    resolve(reply.buildId);
  };
  worker.postMessage({ protocolVersion: SERVICE_WORKER_PROTOCOL_VERSION, requestId, type: "PING" }, [channel.port2]);
});

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
  expectedBuildId: string,
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
  const controller = container.controller;
  if (controller === null) return "reload";
  const activeBuildId = await readBuildIdentity(controller, activationTimeoutMs);
  if (activeBuildId !== expectedBuildId) throw new Error(`Service worker build mismatch: expected ${expectedBuildId}, received ${activeBuildId}`);
  return "ready";
}
