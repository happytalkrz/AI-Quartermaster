import { describe, it, expect } from "vitest";
import { isAllowedLabel } from "../../src/safety/label-filter.js";

describe("isAllowedLabel", () => {
  it("should return true when allowedLabels is empty", () => {
    expect(isAllowedLabel(["bug", "feature"], [])).toBe(true);
    expect(isAllowedLabel([], [])).toBe(true);
  });

  it("should return true when issueLabels contains allowed label", () => {
    expect(isAllowedLabel(["bug", "feature"], ["bug"])).toBe(true);
    expect(isAllowedLabel(["feature"], ["bug", "feature"])).toBe(true);
    expect(isAllowedLabel(["bug", "enhancement", "feature"], ["feature"])).toBe(true);
  });

  it("should return false when issueLabels contains no allowed labels", () => {
    expect(isAllowedLabel(["wontfix"], ["bug", "feature"])).toBe(false);
    expect(isAllowedLabel(["invalid", "duplicate"], ["bug", "feature"])).toBe(false);
  });

  it("should return false when issueLabels is empty but allowedLabels is not", () => {
    expect(isAllowedLabel([], ["bug", "feature"])).toBe(false);
  });

  it("should handle exact string matching", () => {
    expect(isAllowedLabel(["feature-request"], ["feature"])).toBe(false);
    expect(isAllowedLabel(["bug-fix"], ["bug"])).toBe(false);
    expect(isAllowedLabel(["feature"], ["feature"])).toBe(true);
  });
});