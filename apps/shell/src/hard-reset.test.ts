import { describe, expect, it, vi } from "vitest";
import { cacheBustedShellUrl, resetShellRuntime } from "./hard-reset.js";

describe("shell hard reset", () => {
  it("unregisters the scoped worker and deletes only shell caches", async () => {
    const unregister = vi.fn(async () => true);
    const getRegistration = vi.fn(async () => ({ unregister }));
    const deleted: string[] = [];
    const deleteCache = vi.fn(async (name: string) => { deleted.push(name); return true; });

    await resetShellRuntime(
      { getRegistration },
      { keys: async () => ["platform-shell-old", "platform-shell-current", "unrelated"], delete: deleteCache },
      "https://example.test/rocketshell/"
    );

    expect(getRegistration).toHaveBeenCalledWith("https://example.test/rocketshell/");
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleted.sort()).toEqual(["platform-shell-current", "platform-shell-old"]);
  });

  it("continues when no worker is registered", async () => {
    const deleteCache = vi.fn(async () => true);
    await resetShellRuntime(
      { getRegistration: async () => undefined },
      { keys: async () => ["platform-shell-old"], delete: deleteCache },
      "https://example.test/"
    );
    expect(deleteCache).toHaveBeenCalledWith("platform-shell-old");
  });

  it("creates a unique network navigation without discarding existing query data", () => {
    expect(cacheBustedShellUrl("https://example.test/rocketshell/?view=one#dock", "reset-1"))
      .toBe("https://example.test/rocketshell/?view=one&shell-reset=reset-1#dock");
  });
});
