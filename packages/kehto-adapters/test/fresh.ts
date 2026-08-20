import { vi } from "vitest";

/**
 * A private copy of the engine singletons together with the adapters bound to them.
 *
 * Both halves must be re-imported after the reset: the adapters import the services at module
 * scope, so importing only one of the two would leave them pointing at different instances.
 */
export async function freshAdapters(): Promise<{
  readonly engine: typeof import("@platform/nostr-engine");
  readonly adapters: typeof import("../src/index.js");
}> {
  vi.resetModules();
  const engine = await import("@platform/nostr-engine");
  const adapters = await import("../src/index.js");
  return { engine, adapters };
}
