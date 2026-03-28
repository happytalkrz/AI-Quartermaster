import type { ClaudeCliConfig } from "../types/config.js";

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
