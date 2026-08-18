import { describe, expect, it } from "vitest";
import { validateFilters } from "../src/index.js";

describe("relay request limits", () => {
  it("accepts bounded filters and preserves their order", () => {
    const filters = [{ kinds: [1], ids: ["a"], authors: ["b"], "#p": ["c"] }, { limit: 10 }];
    expect(validateFilters(filters)).toEqual(filters);
  });

  it("rejects empty or excessive filter groups", () => {
    expect(() => validateFilters([])).toThrow("invalid-filter");
    expect(() => validateFilters(Array.from({ length: 9 }, () => ({})))).toThrow("invalid-filter");
  });

  it("rejects excessive ids, authors, and tag values", () => {
    const tooMany = Array.from({ length: 1_001 }, (_, index) => String(index));
    expect(() => validateFilters({ ids: tooMany })).toThrow("invalid-filter");
    expect(() => validateFilters({ authors: tooMany })).toThrow("invalid-filter");
    expect(() => validateFilters({ "#e": tooMany })).toThrow("invalid-filter");
  });
});
