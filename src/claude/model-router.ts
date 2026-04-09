import type { ClaudeCliConfig, ExecutionMode, WorkerRole } from "../types/config.js";

export type TaskType = "plan" | "phase" | "review" | "fallback";

/**
 * Resolves the model to use for a given task type.
 * Priority: models[taskType] → model (global default)
 */
export function resolveModel(config: ClaudeCliConfig, taskType: TaskType): string {
  return config.models?.[taskType] || config.model;
}

/**
 * Creates a copy of ClaudeCliConfig with the model set for the given task type.
 * Use this to pass to runClaude() which reads config.model.
 */
export function configForTask(config: ClaudeCliConfig, taskType: TaskType): ClaudeCliConfig {
  return {
    ...config,
    model: resolveModel(config, taskType),
  };
}

/**
 * Model routing based on execution mode and task type.
 * Economy prioritizes speed, thorough prioritizes accuracy.
 */
const EXECUTION_MODE_MODELS: Record<ExecutionMode, Record<TaskType, string>> = {
  economy: {
    plan: "claude-haiku-4-5-20251001",      // Faster planning
    phase: "claude-sonnet-4-20250514",      // Standard implementation
    review: "claude-haiku-4-5-20251001",    // Quick review
    fallback: "claude-haiku-4-5-20251001",  // Fast fallback
  },
  standard: {
    plan: "claude-opus-4-5",                // Standard config
    phase: "claude-sonnet-4-20250514",
    review: "claude-haiku-4-5-20251001",
    fallback: "claude-sonnet-4-20250514",
  },
  thorough: {
    plan: "claude-opus-4-5",                // Thorough planning
    phase: "claude-opus-4-5",               // Careful implementation
    review: "claude-opus-4-5",              // Thorough review
    fallback: "claude-opus-4-5",            // Careful fallback
  },
};

/**
 * Resolves the model based on execution mode and task type.
 * If no execution mode routing is defined, falls back to standard model routing.
 */
export function resolveModelWithExecutionMode(
  config: ClaudeCliConfig,
  taskType: TaskType,
  executionMode: ExecutionMode
): string {
  // First try execution mode specific routing
  const modeModel = EXECUTION_MODE_MODELS[executionMode]?.[taskType];
  if (modeModel) {
    return modeModel;
  }

  // Fallback to standard model routing
  return resolveModel(config, taskType);
}

/**
 * Execution mode specific maxTurns limits
 */
const EXECUTION_MODE_MAX_TURNS: Record<ExecutionMode, number> = {
  economy: 30,    // Fewer turns for speed
  standard: 60,   // Balanced
  thorough: 120,  // More turns for comprehensive work
};

/**
 * Worker role specific disallowed tools mapping
 */
const WORKER_ROLE_DISALLOWED_TOOLS: Record<WorkerRole, string[]> = {
  implementation: [],                    // Implementation workers can use all tools
  review: ["Write", "Edit", "Bash"],    // Review workers blocked from modifying files
};

/**
 * Resolves maxTurns based on execution mode
 */
export function resolveMaxTurnsForMode(
  config: ClaudeCliConfig,
  executionMode: ExecutionMode
): number {
  // If mode-specific maxTurns is configured, use it
  if (config.maxTurnsPerMode?.[executionMode]) {
    return config.maxTurnsPerMode[executionMode];
  }

  // Otherwise use execution mode defaults
  return EXECUTION_MODE_MAX_TURNS[executionMode] || config.maxTurns;
}

/**
 * Creates a copy of ClaudeCliConfig with the model set for the given task type and execution mode.
 * Optionally includes disallowedTools based on worker role.
 */
export function configForTaskWithMode(
  config: ClaudeCliConfig,
  taskType: TaskType,
  executionMode: ExecutionMode,
  workerRole?: WorkerRole
): ClaudeCliConfig & { disallowedTools?: string[] } {
  const baseConfig = {
    ...config,
    model: resolveModelWithExecutionMode(config, taskType, executionMode),
    maxTurns: resolveMaxTurnsForMode(config, executionMode),
  };

  if (workerRole) {
    return {
      ...baseConfig,
      disallowedTools: WORKER_ROLE_DISALLOWED_TOOLS[workerRole],
    };
  }

  return baseConfig;
}
