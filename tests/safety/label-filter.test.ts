import { describe, it, expect } from "vitest";
import { isAllowedLabel, getTriggerLabels } from "../../src/safety/label-filter.js";

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

  it("should return true when issueLabels contains instanceLabel", () => {
    expect(isAllowedLabel(["aqm-by"], ["ai-quartermaster"], "aqm-by")).toBe(true);
    expect(isAllowedLabel(["aqm-by", "bug"], ["ai-quartermaster"], "aqm-by")).toBe(true);
  });

  it("should not require double-config when instanceLabel matches", () => {
    // instanceLabel=aqm-by, allowedLabels does not include it — should still pass
    expect(isAllowedLabel(["aqm-by"], [], "aqm-by")).toBe(true);
  });

  it("should return false when instanceLabel is set but issue has neither instanceLabel nor allowedLabels", () => {
    expect(isAllowedLabel(["unrelated"], ["ai-quartermaster"], "aqm-by")).toBe(false);
  });

  it("should ignore instanceLabel when it is empty string", () => {
    expect(isAllowedLabel(["bug"], [], "")).toBe(true); // empty allowedLabels → allow all
    expect(isAllowedLabel(["bug"], ["feature"], "")).toBe(false);
  });
});

describe("getTriggerLabels", () => {
  it("should return [instanceLabel] when instanceLabel is set", () => {
    expect(getTriggerLabels("aqm", ["bug", "feature"])).toEqual(["aqm"]);
    expect(getTriggerLabels("my-bot", [])).toEqual(["my-bot"]);
  });

  it("should return allowedLabels when instanceLabel is undefined", () => {
    expect(getTriggerLabels(undefined, ["bug", "feature"])).toEqual(["bug", "feature"]);
    expect(getTriggerLabels(undefined, [])).toEqual([]);
  });

  it("should return allowedLabels when instanceLabel is empty string", () => {
    expect(getTriggerLabels("", ["bug", "feature"])).toEqual(["bug", "feature"]);
    expect(getTriggerLabels("", [])).toEqual([]);
  });
});