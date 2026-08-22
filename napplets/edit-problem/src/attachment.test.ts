import { describe, expect, it } from "vitest";
import { attachmentMarkdown } from "./attachment";

describe("attachmentMarkdown", () => {
  it("creates a direct Markdown media reference", () => {
    expect(attachmentMarkdown("https://blossom.example/abc", "Demo"))
      .toBe("![Demo](https://blossom.example/abc)");
  });

  it("rejects unusable upload URLs", () => {
    expect(() => attachmentMarkdown("http://blossom.example/abc", "bad")).toThrow("invalid media URL");
  });
});
