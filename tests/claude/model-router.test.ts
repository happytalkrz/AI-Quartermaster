import { describe, it, expect } from "vitest";
import {
  resolveModel,
  configForTask,
  resolveModelWithExecutionMode,
  resolveMaxTurnsForMode,
  configForTaskWithMode,
  configForWorker,
  WORKER_DISALLOWED_TOOLS,
  type WorkerConfig,
  type WorkerType,
  type TaskType,
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

// ─── WORKER_DISALLOWED_TOOLS ─────────────────────────────────────────────────

describe("WORKER_DISALLOWED_TOOLS", () => {
  it("implementation disallows read tools", () => {
    expect(WORKER_DISALLOWED_TOOLS.implementation).toEqual(["Read", "Glob", "Grep"]);
  });

  it("review disallows write tools", () => {
    expect(WORKER_DISALLOWED_TOOLS.review).toEqual(["Write", "Edit", "Bash"]);
  });

  it("readonly disallows all write and execution tools", () => {
    expect(WORKER_DISALLOWED_TOOLS.readonly).toContain("Write");
    expect(WORKER_DISALLOWED_TOOLS.readonly).toContain("Edit");
    expect(WORKER_DISALLOWED_TOOLS.readonly).toContain("MultiEdit");
    expect(WORKER_DISALLOWED_TOOLS.readonly).toContain("Bash");
    expect(WORKER_DISALLOWED_TOOLS.readonly).toContain("NotebookEdit");
  });

  it("unrestricted has no restrictions", () => {
    expect(WORKER_DISALLOWED_TOOLS.unrestricted).toEqual([]);
  });
});

// ─── resolveModel ────────────────────────────────────────────────────────────

describe("resolveModel", () => {
  it("returns task-specific model when models routing is configured", () => {
    expect(resolveModel(baseConfig, "plan")).toBe("claude-opus-4-5");
    expect(resolveModel(baseConfig, "phase")).toBe("claude-sonnet-4-20250514");
    expect(resolveModel(baseConfig, "review")).toBe("claude-haiku-4-5-20251001");
    expect(resolveModel(baseConfig, "fallback")).toBe("claude-sonnet-4-20250514");
  });

  it("falls back to global model when task-specific model is not set", () => {
    const configNoModels: ClaudeCliConfig = {
      ...baseConfig,
      models: { plan: "", phase: "", review: "", fallback: "" },
    };
    expect(resolveModel(configNoModels, "plan")).toBe("claude-sonnet-4-20250514");
  });
});

// ─── configForTask ───────────────────────────────────────────────────────────

describe("configForTask", () => {
  it("returns config with model set for the given task type", () => {
    const result = configForTask(baseConfig, "plan");
    expect(result.model).toBe("claude-opus-4-5");
  });

  it("does not mutate original config", () => {
    const original = baseConfig.model;
    configForTask(baseConfig, "review");
    expect(baseConfig.model).toBe(original);
  });

  it("preserves all other fields", () => {
    const result = configForTask(baseConfig, "phase");
    expect(result.path).toBe(baseConfig.path);
    expect(result.maxTurns).toBe(baseConfig.maxTurns);
    expect(result.timeout).toBe(baseConfig.timeout);
    expect(result.additionalArgs).toEqual(baseConfig.additionalArgs);
  });
});

// ─── resolveModelWithExecutionMode ───────────────────────────────────────────

describe("resolveModelWithExecutionMode", () => {
  it("economy mode uses faster models", () => {
    expect(resolveModelWithExecutionMode(baseConfig, "plan", "economy")).toBe("claude-haiku-4-5-20251001");
    expect(resolveModelWithExecutionMode(baseConfig, "review", "economy")).toBe("claude-haiku-4-5-20251001");
    expect(resolveModelWithExecutionMode(baseConfig, "fallback", "economy")).toBe("claude-haiku-4-5-20251001");
  });

  it("economy mode phase uses sonnet", () => {
    expect(resolveModelWithExecutionMode(baseConfig, "phase", "economy")).toBe("claude-sonnet-4-20250514");
  });

  it("thorough mode uses opus for all task types", () => {
    const taskTypes: TaskType[] = ["plan", "phase", "review", "fallback"];
    for (const taskType of taskTypes) {
      expect(resolveModelWithExecutionMode(baseConfig, taskType, "thorough")).toBe("claude-opus-4-5");
    }
  });

  it("standard mode uses appropriate models per task type", () => {
    expect(resolveModelWithExecutionMode(baseConfig, "plan", "standard")).toBe("claude-opus-4-5");
    expect(resolveModelWithExecutionMode(baseConfig, "phase", "standard")).toBe("claude-sonnet-4-20250514");
    expect(resolveModelWithExecutionMode(baseConfig, "review", "standard")).toBe("claude-haiku-4-5-20251001");
    expect(resolveModelWithExecutionMode(baseConfig, "fallback", "standard")).toBe("claude-sonnet-4-20250514");
  });
});

// ─── resolveMaxTurnsForMode ───────────────────────────────────────────────────

describe("resolveMaxTurnsForMode", () => {
  it("economy mode returns 30", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "economy")).toBe(30);
  });

  it("standard mode returns 60", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "standard")).toBe(60);
  });

  it("thorough mode returns 120", () => {
    expect(resolveMaxTurnsForMode(baseConfig, "thorough")).toBe(120);
  });

  it("uses maxTurnsPerMode override when configured", () => {
    const configWithOverride: ClaudeCliConfig = {
      ...baseConfig,
      maxTurnsPerMode: { economy: 10, standard: 50, thorough: 200 },
    };
    expect(resolveMaxTurnsForMode(configWithOverride, "economy")).toBe(10);
    expect(resolveMaxTurnsForMode(configWithOverride, "standard")).toBe(50);
    expect(resolveMaxTurnsForMode(configWithOverride, "thorough")).toBe(200);
  });
});

// ─── configForTaskWithMode ────────────────────────────────────────────────────

describe("configForTaskWithMode", () => {
  it("sets model for given task type and execution mode", () => {
    const result = configForTaskWithMode(baseConfig, "phase", "thorough");
    expect(result.model).toBe("claude-opus-4-5");
  });

  it("sets maxTurns based on execution mode", () => {
    const economy = configForTaskWithMode(baseConfig, "phase", "economy");
    const thorough = configForTaskWithMode(baseConfig, "phase", "thorough");
    expect(economy.maxTurns).toBe(30);
    expect(thorough.maxTurns).toBe(120);
  });

  it("does not include disallowedTools (backwards compat)", () => {
    const result = configForTaskWithMode(baseConfig, "phase", "standard");
    expect((result as WorkerConfig).disallowedTools).toBeUndefined();
  });

  it("preserves non-model/maxTurns fields", () => {
    const result = configForTaskWithMode(baseConfig, "review", "economy");
    expect(result.path).toBe(baseConfig.path);
    expect(result.timeout).toBe(baseConfig.timeout);
    expect(result.additionalArgs).toEqual(baseConfig.additionalArgs);
  });
});

// ─── configForWorker ─────────────────────────────────────────────────────────

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

  it("returns WorkerConfig with disallowedTools for readonly worker", () => {
    const result = configForWorker(baseConfig, "review", "standard", "readonly");
    expect(result.disallowedTools).toEqual(WORKER_DISALLOWED_TOOLS.readonly);
    expect(result.disallowedTools).toContain("Write");
    expect(result.disallowedTools).toContain("Edit");
    expect(result.disallowedTools).toContain("MultiEdit");
    expect(result.disallowedTools).toContain("Bash");
    expect(result.disallowedTools).toContain("NotebookEdit");
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

  it("does not mutate original config", () => {
    const originalModel = baseConfig.model;
    configForWorker(baseConfig, "plan", "thorough", "review");
    expect(baseConfig.model).toBe(originalModel);
  });

  it("all WorkerType values produce valid WorkerConfig", () => {
    const workerTypes: WorkerType[] = ["implementation", "review", "readonly", "unrestricted"];
    for (const workerType of workerTypes) {
      const result = configForWorker(baseConfig, "phase", "standard", workerType);
      expect(Array.isArray(result.disallowedTools)).toBe(true);
      expect(typeof result.model).toBe("string");
      expect(typeof result.maxTurns).toBe("number");
    }
  });

  it("is backwards compatible: configForTaskWithMode still works", () => {
    const result = configForTaskWithMode(baseConfig, "phase", "standard");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.maxTurns).toBe(60);
    expect((result as WorkerConfig).disallowedTools).toBeUndefined();
  });
});
