import type { Runtime, ServiceHandler } from "@kehto/runtime";
import { describe, expect, it, vi } from "vitest";
import { registerLinkService } from "../src/index.js";

describe("link service", () => {
  it("opens confirmed HTTPS navigation through the host", async () => {
    let handler: ServiceHandler | undefined;
    const runtime = { registerService: (_name: string, value: ServiceHandler) => { handler = value; } } as unknown as Runtime;
    const openExternal = vi.fn(() => true);
    registerLinkService(runtime, { openExternal, confirm: () => true });
    const send = vi.fn();
    handler!.handleMessage("window-1", { type: "link.open", id: "request-1", url: "https://example.com/path" } as never, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(openExternal).toHaveBeenCalledWith(new URL("https://example.com/path"));
    expect(send).toHaveBeenCalledWith({ type: "link.open.result", id: "request-1", status: "opened" });
  });

  it("denies remote plaintext HTTP, credentials, and rejected consent", async () => {
    let handler: ServiceHandler | undefined;
    const runtime = { registerService: (_name: string, value: ServiceHandler) => { handler = value; } } as unknown as Runtime;
    const openExternal = vi.fn(() => true);
    registerLinkService(runtime, { openExternal, confirm: () => false });
    for (const [id, url] of [
      ["plain", "http://example.com/"],
      ["credentials", "https://user:secret@example.com/"],
      ["consent", "https://example.com/"]
    ]) {
      const send = vi.fn();
      handler!.handleMessage("window-1", { type: "link.open", id, url } as never, send);
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(send.mock.calls[0]![0]).toMatchObject({ type: "link.open.result", id, status: "denied" });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });
});
