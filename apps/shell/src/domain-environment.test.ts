import { describe, expect, it } from "vitest";
import { requireWiredDomains } from "./domain-environment.js";

describe("Napplet domain environment", () => {
  it("blocks navigation requirements that the host cannot provide", () => {
    expect(requireWiredDomains(["identity", "resource"], new Set(["identity", "resource"]))).toEqual(["identity", "resource"]);
    expect(() => requireWiredDomains(["identity", "notify"], new Set(["identity"]))).toThrow("Missing required Napplet domains: notify");
  });
});
