import { describe, it, expect } from "vitest";
import {
  configForWorker,
  configForTaskWithMode,
  WORKER_DISALLOWED_TOOLS,
  type WorkerConfig,
} from "../../src/claude/model-router.js";
import type { ClaudeCliConfig } from "../../src/types/config.js";

const baseConfig: ClaudeCliConfig = {
  path: "claude",
  model: "claude-sonnet-4-20250514",
  models: {
    plan: "claude-opus-4-5",
    phase: "claude-sonnet-4-20250514",
    review: "claude-haiku-4-5-20251001",
    fallback: "claude-sonnet-4-20250514",
  },
  maxTurns: 60,
  timeout: 300000,
  additionalArgs: [],
};

describe("configForWorker", () => {
  it("returns WorkerConfig with disallowedTools for implementation worker", () => {
    const result = configForWorker(baseConfig, "phase", "standard", "implementation");
    expect(result.disallowedTools).toEqual(WORKER_DISALLOWED_TOOLS.implementation);
    expect(result.disallowedTools).toContain("Read");
    expect(result.disallowedTools).toContain("Glob");
    expect(result.disallowedTools).toContain("Grep");
  });

  it("returns WorkerConfig with disallowedTools for review worker", () => {
    const result = configForWorker(baseConfig, "review", "standard", "review");
    expect(result.disallowedTools).toEqual(WORKER_DISALLOWED_TOOLS.review);
    expect(result.disallowedTools).toContain("Write");
    expect(result.disallowedTools).toContain("Edit");
    expect(result.disallowedTools).toContain("Bash");
  });

  it("returns WorkerConfig with empty disallowedTools for unrestricted worker", () => {
    const result = configForWorker(baseConfig, "phase", "standard", "unrestricted");
    expect(result.disallowedTools).toEqual([]);
  });

  it("sets model based on taskType and executionMode", () => {
    const economy = configForWorker(baseConfig, "phase", "economy", "unrestricted");
    const thorough = configForWorker(baseConfig, "phase", "thorough", "unrestricted");
    expect(economy.model).toBe("claude-sonnet-4-20250514");
    expect(thorough.model).toBe("claude-opus-4-5");
  });

  it("sets maxTurns based on executionMode", () => {
    const economy = configForWorker(baseConfig, "phase", "economy", "unrestricted");
    const thorough = configForWorker(baseConfig, "phase", "thorough", "unrestricted");
    expect(economy.maxTurns).toBe(30);
    expect(thorough.maxTurns).toBe(120);
  });

  it("preserves other ClaudeCliConfig fields", () => {
    const result = configForWorker(baseConfig, "phase", "standard", "readonly");
    expect(result.path).toBe(baseConfig.path);
    expect(result.timeout).toBe(baseConfig.timeout);
    expect(result.additionalArgs).toEqual(baseConfig.additionalArgs);
  });

  it("is backwards compatible: configForTaskWithMode still works", () => {
    const result = configForTaskWithMode(baseConfig, "phase", "standard");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.maxTurns).toBe(60);
    expect((result as WorkerConfig).disallowedTools).toBeUndefined();
  });
});
