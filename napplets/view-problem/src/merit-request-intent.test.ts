import { describe, expect, it, vi } from "vitest";
import { canRequestMerits, openAdjacentMeritRequest } from "./merit-request-intent";

describe("merit request intent", () => {
  it("allows requests only for closed problems", () => {
    expect(canRequestMerits("closed")).toBe(true);
    for (const status of ["draft", "rfm", "big", "children", "open", "claimed", "patched"]) {
      expect(canRequestMerits(status)).toBe(false);
    }
  });

  it("opens the merit composer beside the problem viewer", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, handled: true });
    await openAdjacentMeritRequest({ invoke }, "Wallet setup is slow");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith({
      archetype: "composer",
      action: "merit-request",
      convention: "napplet:composer/merit-request",
      payload: { problem: "Wallet setup is slow" },
      behavior: { focus: false, reuse: true }
    });
  });
});
