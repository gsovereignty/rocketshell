import { describe, expect, it, vi } from "vitest";
import { connectPreferredAccount } from "./preferred-account.js";

describe("preferred account connection", () => {
  it("uses NIP-07 when browser extension is available", async () => {
    const connectExtension = vi.fn(async () => "1".repeat(64));
    const connectEphemeral = vi.fn(async () => "2".repeat(64));
    await expect(connectPreferredAccount({ nip07Available: true, connectExtension, connectEphemeral })).resolves.toEqual({ method: "nip07", pubkey: "1".repeat(64) });
    expect(connectExtension).toHaveBeenCalledOnce();
    expect(connectEphemeral).not.toHaveBeenCalled();
  });

  it("creates an ephemeral identity when NIP-07 is absent", async () => {
    const connectExtension = vi.fn(async () => "1".repeat(64));
    const connectEphemeral = vi.fn(async () => "2".repeat(64));
    await expect(connectPreferredAccount({ nip07Available: false, connectExtension, connectEphemeral })).resolves.toEqual({ method: "ephemeral", pubkey: "2".repeat(64) });
    expect(connectExtension).not.toHaveBeenCalled();
    expect(connectEphemeral).toHaveBeenCalledOnce();
  });

  it("falls back to ephemeral when NIP-07 connection fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("extension rejected request");
    const connectExtension = vi.fn(async () => { throw failure; });
    const connectEphemeral = vi.fn(async () => "2".repeat(64));
    await expect(connectPreferredAccount({ nip07Available: true, connectExtension, connectEphemeral })).resolves.toEqual({ method: "ephemeral", pubkey: "2".repeat(64) });
    expect(warning).toHaveBeenCalledWith("NIP-07 account connection failed; creating ephemeral identity", { error: failure });
    warning.mockRestore();
  });
});
