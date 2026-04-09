import { describe, it, expect } from "vitest";
import { CliSource } from "../../../src/config/sources/cli-source.js";
import type { LoadContext } from "../../../src/config/sources/types.js";

const baseContext: LoadContext = { projectRoot: "/fake/root" };

describe("CliSource", () => {
  it("should have name 'cli'", () => {
    const source = new CliSource();
    expect(source.name).toBe("cli");
  });

  it("should return null when configOverrides is undefined", () => {
    const source = new CliSource();
    expect(source.load(baseContext)).toBeNull();
  });

  it("should return null when configOverrides is empty object", () => {
    const source = new CliSource();
    const context: LoadContext = { ...baseContext, configOverrides: {} };
    expect(source.load(context)).toBeNull();
  });

  it("should return configOverrides when provided", () => {
    const source = new CliSource();
    const overrides = { general: { logLevel: "debug" } };
    const context: LoadContext = { ...baseContext, configOverrides: overrides };
    expect(source.load(context)).toEqual(overrides);
  });

  it("should return configOverrides as-is (no deep copy)", () => {
    const source = new CliSource();
    const overrides = { general: { concurrency: 3 }, safety: { maxPhases: 5 } };
    const context: LoadContext = { ...baseContext, configOverrides: overrides };
    const result = source.load(context);
    expect(result).toBe(overrides);
  });

  it("should handle nested configOverrides", () => {
    const source = new CliSource();
    const overrides = {
      general: { projectName: "test", logLevel: "info" },
      safety: { allowedLabels: ["bug", "enhancement"] }
    };
    const context: LoadContext = { ...baseContext, configOverrides: overrides };
    expect(source.load(context)).toEqual(overrides);
  });

  it("should implement ConfigSource interface synchronously", () => {
    const source = new CliSource();
    const overrides = { general: { dryRun: true } };
    const context: LoadContext = { ...baseContext, configOverrides: overrides };
    const result = source.load(context);
    // Should not be a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual(overrides);
  });
});
