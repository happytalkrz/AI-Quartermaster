import { randomUUID } from "crypto";
import { runClaude } from "./claude-runner.js";
import type { ClaudeRunOptions, ClaudeRunResult } from "./claude-runner.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface CoordinatorTask {
  id: string;
  options: ClaudeRunOptions;
  submittedAt: string;
  priority?: number;
}

export interface CoordinatorResult {
  taskId: string;
  status: TaskStatus;
  result?: ClaudeRunResult;
  error?: string;
  completedAt?: string;
  durationMs?: number;
}

/** Worker pool interface — implemented in Phase 3 (worker-pool integration) */
export interface WorkerPool {
  submitTask(task: CoordinatorTask): Promise<ClaudeRunResult>;
  isAvailable(): boolean;
}

/**
 * Coordinator manages task submission and result tracking.
 *
 * When multiAI is enabled and a worker pool is available, tasks are
 * dispatched to the pool for parallel execution. Otherwise the coordinator
 * falls back to the single claude-runner.
 */
export class Coordinator {
  private readonly tasks = new Map<string, CoordinatorResult>();
  private readonly waiters = new Map<string, Array<(result: CoordinatorResult) => void>>();
  private readonly multiAIEnabled: boolean;
  private readonly workerPool?: WorkerPool;

  constructor(multiAIEnabled: boolean, workerPool?: WorkerPool) {
    this.multiAIEnabled = multiAIEnabled;
    this.workerPool = workerPool;
  }

  /**
   * Submit a task for execution. Returns the task ID immediately.
   * The task runs asynchronously in the background.
   */
  async submitTask(options: ClaudeRunOptions): Promise<string> {
    const taskId = randomUUID();
    const task: CoordinatorTask = {
      id: taskId,
      options,
      submittedAt: new Date().toISOString(),
    };

    this.tasks.set(taskId, { taskId, status: "pending" });

    // Fire-and-forget; errors are captured in the task result
    this._executeTask(task).catch(() => undefined);

    return taskId;
  }

  /**
   * Returns the current status of a task, or undefined if not found.
   */
  getStatus(taskId: string): CoordinatorResult | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Waits until the given task reaches a terminal state (completed/failed).
   * Resolves immediately if the task is already done.
   */
  async waitForCompletion(taskId: string): Promise<CoordinatorResult> {
    const current = this.tasks.get(taskId);

    if (!current) {
      return { taskId, status: "failed", error: `Unknown task: ${taskId}` };
    }

    if (current.status === "completed" || current.status === "failed") {
      return current;
    }

    return new Promise<CoordinatorResult>((resolve) => {
      const queue = this.waiters.get(taskId) ?? [];
      queue.push(resolve);
      this.waiters.set(taskId, queue);
    });
  }

  private async _executeTask(task: CoordinatorTask): Promise<void> {
    const entry = this.tasks.get(task.id);
    if (!entry) return;

    entry.status = "running";

    const logger = getLogger();
    const useWorkerPool = this.multiAIEnabled && this.workerPool?.isAvailable() === true;

    if (useWorkerPool) {
      logger.debug(`[Coordinator] task ${task.id} → worker pool`);
    } else {
      logger.debug(`[Coordinator] task ${task.id} → claude-runner (fallback)`);
    }

    try {
      let result: ClaudeRunResult;

      if (useWorkerPool && this.workerPool) {
        result = await this.workerPool.submitTask(task);
      } else {
        result = await runClaude(task.options);
      }

      const completed: CoordinatorResult = {
        taskId: task.id,
        status: result.success ? "completed" : "failed",
        result,
        error: result.success ? undefined : result.output,
        completedAt: new Date().toISOString(),
        durationMs: result.durationMs,
      };

      this.tasks.set(task.id, completed);
      this._resolveWaiters(task.id, completed);
    } catch (err: unknown) {
      const failed: CoordinatorResult = {
        taskId: task.id,
        status: "failed",
        error: getErrorMessage(err),
        completedAt: new Date().toISOString(),
      };

      this.tasks.set(task.id, failed);
      this._resolveWaiters(task.id, failed);
    }
  }

  private _resolveWaiters(taskId: string, result: CoordinatorResult): void {
    const queue = this.waiters.get(taskId);
    if (!queue) return;

    for (const resolve of queue) {
      resolve(result);
    }

    this.waiters.delete(taskId);
  }
}
