import type { ClaudeCliConfig, ExecutionMode, WorkerRole } from "../types/config.js";
import { CLAUDE_MODELS } from "./model-constants.js";

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
    plan: CLAUDE_MODELS.SONNET,        // Better plan quality
    phase: CLAUDE_MODELS.SONNET,       // Standard implementation
    review: CLAUDE_MODELS.HAIKU,       // Quick review
    fallback: CLAUDE_MODELS.HAIKU,     // Fast fallback
  },
  standard: {
    plan: CLAUDE_MODELS.OPUS,          // Standard config
    phase: CLAUDE_MODELS.SONNET,
    review: CLAUDE_MODELS.HAIKU,
    fallback: CLAUDE_MODELS.SONNET,
  },
  thorough: {
    plan: CLAUDE_MODELS.OPUS,          // Thorough planning
    phase: CLAUDE_MODELS.OPUS,         // Careful implementation
    review: CLAUDE_MODELS.OPUS,        // Thorough review
    fallback: CLAUDE_MODELS.OPUS,      // Careful fallback
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
  economy: 50,    // Fewer turns for speed
  standard: 100,  // Balanced
  thorough: 180,  // More turns for comprehensive work
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
 * Resolves the fallback chain of models for QUOTA_EXHAUSTED scenarios.
 *
 * - If modelFallbackChain is explicitly configured, returns it as-is.
 * - Otherwise, derives the chain from [models.phase, models.fallback] with deduplication.
 *   EXECUTION_MODE_MODELS entries are intentionally not merged here — the phase-executor
 *   resolves the initial model via resolveModelWithExecutionMode, so the remaining chain
 *   should reflect the config-level fallbacks (models.phase → models.fallback).
 */
export function resolveFallbackChain(config: ClaudeCliConfig): string[] {
  if (config.modelFallbackChain && config.modelFallbackChain.length > 0) {
    return config.modelFallbackChain;
  }

  const chain: string[] = [];
  const seen = new Set<string>();

  for (const model of [config.models.phase, config.models.fallback]) {
    if (model && !seen.has(model)) {
      seen.add(model);
      chain.push(model);
    }
  }

  return chain;
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
