import { describe, it, expect } from "vitest";
import {
  resolveModel,
  configForTask,
  resolveModelWithExecutionMode,
  resolveMaxTurnsForMode,
  configForTaskWithMode,
} from "../../src/claude/model-router.js";
import type { ClaudeCliConfig } from "../../src/types/config.js";

const baseConfig: ClaudeCliConfig = {
  path: "claude",
  model: "claude-sonnet-4-20250514",
  maxTurns: 60,
  timeout: 30000,
  additionalArgs: [],
};

describe("resolveModel", () => {
  it("should return task-specific model when models config is set", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: "claude-opus-4-5",
        phase: "claude-sonnet-4-20250514",
        review: "claude-haiku-4-5-20251001",
        fallback: "claude-haiku-4-5-20251001",
      },
    };

    expect(resolveModel(config, "plan")).toBe("claude-opus-4-5");
    expect(resolveModel(config, "phase")).toBe("claude-sonnet-4-20250514");
    expect(resolveModel(config, "review")).toBe("claude-haiku-4-5-20251001");
  });

  it("should fall back to global model when models config is not set", () => {
    expect(resolveModel(baseConfig, "plan")).toBe("claude-sonnet-4-20250514");
    expect(resolveModel(baseConfig, "phase")).toBe("claude-sonnet-4-20250514");
  });
});

describe("configForTask", () => {
  it("should return config with model set for the task type", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: "claude-opus-4-5",
        phase: "claude-sonnet-4-20250514",
        review: "claude-haiku-4-5-20251001",
        fallback: "claude-haiku-4-5-20251001",
      },
    };

    const result = configForTask(config, "plan");
    expect(result.model).toBe("claude-opus-4-5");
  });

  it("should preserve other config fields", () => {
    const result = configForTask(baseConfig, "plan");
    expect(result.maxTurns).toBe(baseConfig.maxTurns);
    expect(result.timeout).toBe(baseConfig.timeout);
  });
});

describe("resolveModelWithExecutionMode", () => {
  describe("economy mode", () => {
    it("should use sonnet for plan task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "economy");
      expect(model).toBe("claude-sonnet-4-20250514");
    });

    it("should use sonnet for phase task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "phase", "economy");
      expect(model).toBe("claude-sonnet-4-20250514");
    });

    it("should use haiku for review task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "review", "economy");
      expect(model).toBe("claude-haiku-4-5-20251001");
    });

    it("should use haiku for fallback task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "fallback", "economy");
      expect(model).toBe("claude-haiku-4-5-20251001");
    });

    it("should NOT use haiku for plan task (regression guard)", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "economy");
      expect(model).not.toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("standard mode", () => {
    it("should use opus for plan task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "standard");
      expect(model).toBe("claude-opus-4-5");
    });

    it("should use sonnet for phase task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "phase", "standard");
      expect(model).toBe("claude-sonnet-4-20250514");
    });

    it("should use haiku for review task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "review", "standard");
      expect(model).toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("thorough mode", () => {
    it("should use opus for plan task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "thorough");
      expect(model).toBe("claude-opus-4-5");
    });

    it("should use opus for phase task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "phase", "thorough");
      expect(model).toBe("claude-opus-4-5");
    });

    it("should use opus for review task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "review", "thorough");
      expect(model).toBe("claude-opus-4-5");
    });

    it("should use opus for fallback task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "fallback", "thorough");
      expect(model).toBe("claude-opus-4-5");
    });
  });
});

describe("resolveMaxTurnsForMode", () => {
  it("should return economy mode maxTurns default", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "economy")).toBe(30);
  });

  it("should return standard mode maxTurns default", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "standard")).toBe(60);
  });

  it("should return thorough mode maxTurns default", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "thorough")).toBe(120);
  });

  it("should use config maxTurnsPerMode override when set", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      maxTurnsPerMode: { economy: 10, standard: 50, thorough: 200 },
    };

    expect(resolveMaxTurnsForMode(config, "economy")).toBe(10);
    expect(resolveMaxTurnsForMode(config, "standard")).toBe(50);
    expect(resolveMaxTurnsForMode(config, "thorough")).toBe(200);
  });
});

describe("configForTaskWithMode", () => {
  it("should set correct model and maxTurns for economy plan", () => {
    const result = configForTaskWithMode(baseConfig, "plan", "economy");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.maxTurns).toBe(30);
  });

  it("should set disallowedTools for review worker role", () => {
    const result = configForTaskWithMode(baseConfig, "review", "standard", "review");
    expect(result.disallowedTools).toEqual(["Write", "Edit", "Bash"]);
  });

  it("should set empty disallowedTools for implementation worker role", () => {
    const result = configForTaskWithMode(baseConfig, "phase", "standard", "implementation");
    expect(result.disallowedTools).toEqual([]);
  });

  it("should not set disallowedTools when workerRole is not provided", () => {
    const result = configForTaskWithMode(baseConfig, "plan", "economy");
    expect(result.disallowedTools).toBeUndefined();
  });
});
