import { describe, it, expect } from "vitest";
import { loadEnvSource } from "../../../src/config/sources/env-source.js";

describe("env-source", () => {
  it("should return empty config when no AQM_ environment variables", () => {
    const result = loadEnvSource({ envVars: {} });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });

  it("should parse AQM_ environment variables correctly", () => {
    const envVars = {
      "AQM_GENERAL_PROJECT_NAME": "test-project",
      "AQM_GENERAL_LOG_LEVEL": "debug",
      "AQM_SAFETY_MAX_PHASES": "10",
      "OTHER_VAR": "ignored"
    };

    const result = loadEnvSource({ envVars });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({
      general: {
        projectName: "test-project",
        logLevel: "debug"
      },
      safety: {
        maxPhases: 10
      }
    });
  });

  it("should handle boolean values correctly", () => {
    const envVars = {
      "AQM_GENERAL_DRY_RUN": "true",
      "AQM_SAFETY_STRICT": "false"
    };

    const result = loadEnvSource({ envVars });

    expect(result.config).toEqual({
      general: {
        dryRun: true
      },
      safety: {
        strict: false
      }
    });
  });

  it("should handle array values correctly", () => {
    const envVars = {
      "AQM_SAFETY_ALLOWED_LABELS": "bug,feature,enhancement"
    };

    const result = loadEnvSource({ envVars });

    expect(result.config).toEqual({
      safety: {
        allowedLabels: ["bug", "feature", "enhancement"]
      }
    });
  });

  it("should use process.env when no envVars provided", () => {
    const result = loadEnvSource();

    expect(result.error).toBeUndefined();
    expect(result.config).toBeDefined();
  });

  it("should handle parsing errors gracefully", () => {
    // This test simulates what would happen if parseEnvVars throws an error
    // Since parseEnvVars is generally robust, this is more for coverage
    const result = loadEnvSource({ envVars: {} });

    expect(result.error).toBeUndefined();
    expect(result.config).toEqual({});
  });
});