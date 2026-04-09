import { describe, it, expect } from "vitest";
import { loadCliSource } from "../../../src/config/sources/cli-source.js";

describe("cli-source", () => {
  it("should return empty config when no overrides provided", () => {
    const result = loadCliSource();

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });

  it("should return empty config when empty overrides provided", () => {
    const result = loadCliSource({ configOverrides: {} });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });

  it("should return config overrides as provided", () => {
    const overrides = {
      general: {
        logLevel: "debug",
        dryRun: true
      },
      safety: {
        maxPhases: 15
      }
    };

    const result = loadCliSource({ configOverrides: overrides });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual(overrides);
  });

  it("should handle nested object overrides", () => {
    const overrides = {
      commands: {
        claudeCli: {
          model: "claude-3-opus"
        }
      }
    };

    const result = loadCliSource({ configOverrides: overrides });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual(overrides);
  });

  it("should handle primitive value overrides", () => {
    const overrides = {
      stringValue: "test",
      numberValue: 42,
      booleanValue: true,
      nullValue: null
    };

    const result = loadCliSource({ configOverrides: overrides });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual(overrides);
  });

  it("should handle array overrides", () => {
    const overrides = {
      safety: {
        allowedLabels: ["bug", "feature"],
        sensitivePaths: ["/etc", "/home"]
      }
    };

    const result = loadCliSource({ configOverrides: overrides });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual(overrides);
  });
});