interface PendingReady {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(reason: Error): void;
  settled: boolean;
}

export function createReadyRegistry() {
  const pending = new Map<string, PendingReady>();
  return {
    register(windowId: string): void {
      let resolvePromise: () => void = () => {};
      let rejectPromise: (reason: Error) => void = () => {};
      const promise = new Promise<void>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
      pending.set(windowId, { promise, resolve: resolvePromise, reject: rejectPromise, settled: false });
    },
    wait(windowId: string): Promise<void> {
      return pending.get(windowId)?.promise ?? Promise.reject(new Error("Window identity not registered"));
    },
    resolve(windowId: string): void {
      const entry = pending.get(windowId);
      if (entry && !entry.settled) { entry.settled = true; entry.resolve(); }
    },
    remove(windowId: string): void {
      const entry = pending.get(windowId);
      if (entry && !entry.settled) { entry.settled = true; entry.reject(new Error("Napplet window destroyed before ready")); }
      pending.delete(windowId);
    }
  };
}
