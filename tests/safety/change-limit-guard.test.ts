import { describe, it, expect } from "vitest";
import { checkChangeLimits } from "../../src/safety/change-limit-guard.js";

describe("checkChangeLimits", () => {
  const limits = { maxFileChanges: 30, maxInsertions: 2000, maxDeletions: 1000 };

  it("should pass within limits", () => {
    expect(() => checkChangeLimits({ filesChanged: 10, insertions: 500, deletions: 200 }, limits)).not.toThrow();
  });

  it("should throw when file count exceeds limit", () => {
    expect(() => checkChangeLimits({ filesChanged: 31, insertions: 0, deletions: 0 }, limits)).toThrow("ChangeLimitGuard");
  });

  it("should throw when insertions exceed limit", () => {
    expect(() => checkChangeLimits({ filesChanged: 1, insertions: 2001, deletions: 0 }, limits)).toThrow("ChangeLimitGuard");
  });

  it("should throw when deletions exceed limit", () => {
    expect(() => checkChangeLimits({ filesChanged: 1, insertions: 0, deletions: 1001 }, limits)).toThrow("ChangeLimitGuard");
  });
});
