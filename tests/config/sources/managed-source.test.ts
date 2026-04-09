import { describe, it, expect } from "vitest";
import { ManagedSource } from "../../../src/config/sources/managed-source.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";

describe("ManagedSource", () => {
  it("should have name 'managed'", () => {
    const source = new ManagedSource();
    expect(source.name).toBe("managed");
  });

  it("should return DEFAULT_CONFIG values", () => {
    const source = new ManagedSource();
    const result = source.load();
    expect(result).toMatchObject({
      general: expect.objectContaining({
        projectName: DEFAULT_CONFIG.general.projectName,
        logLevel: DEFAULT_CONFIG.general.logLevel,
      }),
    });
  });

  it("should return a deep clone (not the same reference)", () => {
    const source = new ManagedSource();
    const result1 = source.load();
    const result2 = source.load();
    expect(result1).not.toBe(result2);
    // Mutating result1 should not affect result2
    (result1 as Record<string, unknown>).general = { mutated: true };
    const result3 = source.load();
    expect((result3 as Record<string, unknown>).general).not.toEqual({ mutated: true });
  });

  it("should include all top-level config sections", () => {
    const source = new ManagedSource();
    const result = source.load();
    expect(result).toHaveProperty("general");
    expect(result).toHaveProperty("git");
    expect(result).toHaveProperty("worktree");
    expect(result).toHaveProperty("commands");
    expect(result).toHaveProperty("safety");
  });

  it("should return a synchronous result (not a Promise)", () => {
    const source = new ManagedSource();
    const result = source.load();
    expect(result).not.toBeInstanceOf(Promise);
  });
});
