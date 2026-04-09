import { describe, it, expect } from "vitest";
import { loadManagedSource } from "../../../src/config/sources/managed-source.js";

describe("managed-source", () => {
  it("should return empty config (not yet implemented)", () => {
    const result = loadManagedSource();

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });

  it("should return empty config with options", () => {
    const result = loadManagedSource({});

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });
});