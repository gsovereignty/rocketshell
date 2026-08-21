import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./time";

describe("relative discussion time", () => {
  const now = Date.UTC(2026, 7, 21, 12);

  it("formats recent comments", () => {
    expect(formatRelativeTime(now / 1000 - 30, now)).toBe("30 sec. ago");
    expect(formatRelativeTime(now / 1000 - 5 * 60, now)).toBe("5 min. ago");
    expect(formatRelativeTime(now / 1000 - 3 * 3600, now)).toBe("3 hr. ago");
  });

  it("formats older comments", () => {
    expect(formatRelativeTime(now / 1000 - 2 * 86400, now)).toBe("2 days ago");
    expect(formatRelativeTime(now / 1000 - 14 * 86400, now)).toBe("2 wk. ago");
  });
});
