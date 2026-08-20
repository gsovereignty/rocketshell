import { vi } from "vitest";

/**
 * A private copy of the service singletons.
 *
 * The services are module scoped, so tests that admit events or drive the account manager would
 * otherwise leak state into each other. Resetting the registry and re-importing gives each test its
 * own store, pool and account manager. Only use the bindings this returns: anything imported
 * statically at the top of a test file still points at the first copy.
 */
export async function freshServices(): Promise<typeof import("../src/index.js")> {
  vi.resetModules();
  return await import("../src/index.js");
}
