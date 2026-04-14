import { describe, it, expect } from "vitest";
import {
  resolveModel,
  configForTask,
  resolveModelWithExecutionMode,
  resolveMaxTurnsForMode,
  configForTaskWithMode,
  resolveFallbackChain,
} from "../../src/claude/model-router.js";
import { CLAUDE_MODELS } from "../../src/claude/model-constants.js";
import type { ClaudeCliConfig } from "../../src/types/config.js";

const baseConfig: ClaudeCliConfig = {
  path: "claude",
  model: CLAUDE_MODELS.SONNET,
  maxTurns: 60,
  timeout: 30000,
  additionalArgs: [],
};

describe("resolveModel", () => {
  it("should return task-specific model when models config is set", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: CLAUDE_MODELS.OPUS,
        phase: CLAUDE_MODELS.SONNET,
        review: CLAUDE_MODELS.HAIKU,
        fallback: CLAUDE_MODELS.HAIKU,
      },
    };

    expect(resolveModel(config, "plan")).toBe(CLAUDE_MODELS.OPUS);
    expect(resolveModel(config, "phase")).toBe(CLAUDE_MODELS.SONNET);
    expect(resolveModel(config, "review")).toBe(CLAUDE_MODELS.HAIKU);
  });

  it("should fall back to global model when models config is not set", () => {
    expect(resolveModel(baseConfig, "plan")).toBe(CLAUDE_MODELS.SONNET);
    expect(resolveModel(baseConfig, "phase")).toBe(CLAUDE_MODELS.SONNET);
  });
});

describe("configForTask", () => {
  it("should return config with model set for the task type", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: CLAUDE_MODELS.OPUS,
        phase: CLAUDE_MODELS.SONNET,
        review: CLAUDE_MODELS.HAIKU,
        fallback: CLAUDE_MODELS.HAIKU,
      },
    };

    const result = configForTask(config, "plan");
    expect(result.model).toBe(CLAUDE_MODELS.OPUS);
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
      expect(model).toBe(CLAUDE_MODELS.SONNET);
    });

    it("should use sonnet for phase task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "phase", "economy");
      expect(model).toBe(CLAUDE_MODELS.SONNET);
    });

    it("should use haiku for review task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "review", "economy");
      expect(model).toBe(CLAUDE_MODELS.HAIKU);
    });

    it("should use haiku for fallback task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "fallback", "economy");
      expect(model).toBe(CLAUDE_MODELS.HAIKU);
    });

    it("should NOT use haiku for plan task (regression guard)", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "economy");
      expect(model).not.toBe(CLAUDE_MODELS.HAIKU);
    });
  });

  describe("standard mode", () => {
    it("should use opus for plan task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "standard");
      expect(model).toBe(CLAUDE_MODELS.OPUS);
    });

    it("should use sonnet for phase task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "phase", "standard");
      expect(model).toBe(CLAUDE_MODELS.SONNET);
    });

    it("should use haiku for review task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "review", "standard");
      expect(model).toBe(CLAUDE_MODELS.HAIKU);
    });
  });

  describe("thorough mode", () => {
    it("should use opus for plan task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "plan", "thorough");
      expect(model).toBe(CLAUDE_MODELS.OPUS);
    });

    it("should use opus for phase task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "phase", "thorough");
      expect(model).toBe(CLAUDE_MODELS.OPUS);
    });

    it("should use opus for review task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "review", "thorough");
      expect(model).toBe(CLAUDE_MODELS.OPUS);
    });

    it("should use opus for fallback task", () => {
      const model = resolveModelWithExecutionMode(baseConfig, "fallback", "thorough");
      expect(model).toBe(CLAUDE_MODELS.OPUS);
    });
  });
});

describe("resolveMaxTurnsForMode", () => {
  it("should return economy mode maxTurns default", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "economy")).toBe(50);
  });

  it("should return standard mode maxTurns default", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "standard")).toBe(100);
  });

  it("should return thorough mode maxTurns default", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "thorough")).toBe(180);
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
    expect(result.model).toBe(CLAUDE_MODELS.SONNET);
    expect(result.maxTurns).toBe(50);
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

describe("resolveFallbackChain", () => {
  it("returns explicit modelFallbackChain as-is when set", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: CLAUDE_MODELS.OPUS,
        phase: CLAUDE_MODELS.SONNET,
        review: CLAUDE_MODELS.HAIKU,
        fallback: CLAUDE_MODELS.HAIKU,
      },
      modelFallbackChain: ["claude-custom-model", CLAUDE_MODELS.HAIKU],
    };
    expect(resolveFallbackChain(config)).toEqual(["claude-custom-model", CLAUDE_MODELS.HAIKU]);
  });

  it("derives chain from models.phase and models.fallback when modelFallbackChain is not set", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: CLAUDE_MODELS.OPUS,
        phase: CLAUDE_MODELS.SONNET,
        review: CLAUDE_MODELS.HAIKU,
        fallback: CLAUDE_MODELS.HAIKU,
      },
    };
    const chain = resolveFallbackChain(config);
    expect(chain).toContain(CLAUDE_MODELS.SONNET);
    expect(chain).toContain(CLAUDE_MODELS.HAIKU);
  });

  it("deduplicates when models.phase equals models.fallback", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: CLAUDE_MODELS.OPUS,
        phase: CLAUDE_MODELS.SONNET,
        review: CLAUDE_MODELS.HAIKU,
        fallback: CLAUDE_MODELS.SONNET,
      },
    };
    const chain = resolveFallbackChain(config);
    expect(chain).toEqual([CLAUDE_MODELS.SONNET]);
  });

  it("returns chain with phase first and fallback second when models differ", () => {
    const config: ClaudeCliConfig = {
      ...baseConfig,
      models: {
        plan: CLAUDE_MODELS.OPUS,
        phase: CLAUDE_MODELS.SONNET,
        review: CLAUDE_MODELS.HAIKU,
        fallback: CLAUDE_MODELS.HAIKU,
      },
    };
    const chain = resolveFallbackChain(config);
    expect(chain[0]).toBe(CLAUDE_MODELS.SONNET);
    expect(chain[1]).toBe(CLAUDE_MODELS.HAIKU);
    expect(chain).toHaveLength(2);
  });
});
