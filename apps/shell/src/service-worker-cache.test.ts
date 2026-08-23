import { describe, expect, it } from "vitest";
import { isBuiltInNappletRequest } from "./service-worker-cache";

describe("service worker cache policy", () => {
  it("bypasses cache for built-in registry and artifacts at root scope", () => {
    expect(isBuiltInNappletRequest("/napplets.json", "/")).toBe(true);
    expect(isBuiltInNappletRequest("/napplets/view-problem/index.html", "/")).toBe(true);
  });

  it("bypasses cache for GitHub Pages scoped built-ins only", () => {
    expect(isBuiltInNappletRequest("/rocketshell/napplets.json", "/rocketshell/")).toBe(true);
    expect(isBuiltInNappletRequest("/rocketshell/napplets/view-problem/index.html", "/rocketshell/")).toBe(true);
    expect(isBuiltInNappletRequest("/napplets/view-problem/index.html", "/rocketshell/")).toBe(false);
    expect(isBuiltInNappletRequest("/rocketshell/assets/shell.js", "/rocketshell/")).toBe(false);
  });
});
