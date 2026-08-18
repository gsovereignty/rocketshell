import { describe, expect, it } from "vitest";
import { createReadyRegistry } from "./ready-registry.js";

describe("window ready registry", () => {
  it("rejects pending startup when its window is destroyed", async () => {
    const registry = createReadyRegistry();
    registry.register("window-1");
    const ready = registry.wait("window-1");
    registry.remove("window-1");
    await expect(ready).rejects.toThrow("destroyed before ready");
  });

  it("keeps an already-ready window settled during cleanup", async () => {
    const registry = createReadyRegistry();
    registry.register("window-1");
    const ready = registry.wait("window-1");
    registry.resolve("window-1");
    registry.remove("window-1");
    await expect(ready).resolves.toBeUndefined();
  });
});
