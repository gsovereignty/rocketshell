import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sandboxed problem editor markup", () => {
  it("uses scripted controls without native form submission", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(source).not.toContain("<form");
    expect(source).not.toContain('addEventListener("submit"');
    expect(source).toContain('type="button"');
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain("event.preventDefault()");
  });
});
