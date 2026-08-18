import type { Runtime } from "@kehto/runtime";
import type { Theme } from "@napplet/nap/theme/types";
import { describe, expect, it, vi } from "vitest";
import { registerCoreHostServices } from "../src/index.js";

describe("core host services", () => {
  it("forwards host theme changes to the shell publisher", () => {
    const registerService = vi.fn(); const publishTheme = vi.fn();
    const services = registerCoreHostServices({ registerService } as unknown as Runtime, {
      openSettings: vi.fn(), publishTheme
    });
    const theme: Theme = { colors: { background: "#000", text: "#fff", primary: "#f00" } };
    services.theme.publishTheme(theme);
    expect(publishTheme).toHaveBeenCalledWith(theme);
    expect(registerService.mock.calls.map(([name]) => name)).toEqual(["theme", "config", "link"]);
  });
  it("passes validated schema state to the host settings editor", () => {
    const handlers = new Map<string, { handleMessage: Function }>(); const openSettings = vi.fn();
    registerCoreHostServices({ registerService: (name: string, handler: { handleMessage: Function }) => handlers.set(name, handler) } as unknown as Runtime, { openSettings });
    const send = vi.fn(); const config = handlers.get("config")!;
    config.handleMessage("window-1", {
      type: "config.registerSchema", id: "schema-1",
      schema: { type: "object", properties: { color: { type: "string", default: "blue" } } }
    }, send);
    config.handleMessage("window-1", { type: "config.openSettings", section: "missing" }, send);
    expect(openSettings).toHaveBeenCalledWith("window-1", undefined, expect.objectContaining({ values: { color: "blue" }, commit: expect.any(Function) }));
  });
});
