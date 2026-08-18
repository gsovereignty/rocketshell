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
});
