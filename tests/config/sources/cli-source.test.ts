import { describe, it, expect } from "vitest";
import { CliSource } from "../../../src/config/sources/cli-source.js";

describe("CliSource", () => {
  it("should have name 'cli'", () => {
    const source = new CliSource({});
    expect(source.name).toBe("cli");
  });

  it("should return the overrides as-is", () => {
    const overrides = { general: { logLevel: "debug" }, safety: { maxPhases: 5 } };
    const source = new CliSource(overrides);
    expect(source.load()).toEqual(overrides);
  });

  it("should return empty object when no overrides", () => {
    const source = new CliSource({});
    expect(source.load()).toEqual({});
  });

  it("should return the same reference passed in", () => {
    const overrides = { general: { concurrency: 2 } };
    const source = new CliSource(overrides);
    expect(source.load()).toBe(overrides);
  });

  it("should handle nested override objects", () => {
    const overrides = {
      commands: { claudeCli: { model: "claude-haiku-4-5-20251001" } },
    };
    const source = new CliSource(overrides);
    const result = source.load();
    expect(result).toHaveProperty("commands.claudeCli.model", "claude-haiku-4-5-20251001");
  });
});
