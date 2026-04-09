import { describe, it, expect } from "vitest";
import { loadUserSource } from "../../../src/config/sources/user-source.js";

describe("user-source", () => {
  it("should return empty config (not yet implemented)", () => {
    const result = loadUserSource();

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });

  it("should return empty config with options", () => {
    const result = loadUserSource({});

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });
});