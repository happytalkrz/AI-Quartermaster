import { WorkerPool, WorkerTaskHandler } from "./worker-pool.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

const logger = getLogger();

export interface ClaudeTask {
  id: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  additionalArgs?: string[];
}

export interface ClaudeTaskResult {
  taskId: string;
  workerId: string;
  output: string;
  success: boolean;
  error?: string;
  duration: number;
}

export interface CoordinatorConfig {
  maxWorkers: number;
  claudeCliPath: string;
  defaultModel: string;
  timeout: number;
}

/**
 * Claude Worker Pool과 통합하여 태스크를 분배하고 결과를 수집하는 Coordinator.
 * 다중 Claude 인스턴스 간의 작업 분산을 담당한다.
 */
export class Coordinator {
  private pool: WorkerPool<ClaudeTask, ClaudeTaskResult>;
  private config: CoordinatorConfig;

  constructor(config: CoordinatorConfig) {
    this.config = config;

    // WorkerPool에 Claude CLI 태스크 핸들러 설정
    const handler: WorkerTaskHandler<ClaudeTask, ClaudeTaskResult> = async (
      task: ClaudeTask,
      workerId: string
    ) => {
      return this.executeClaudeTask(task, workerId);
    };

    this.pool = new WorkerPool(config.maxWorkers, handler);
    logger.info(`Coordinator initialized with ${config.maxWorkers} max workers`);
  }

  /**
   * 개별 Claude 태스크를 실행한다.
   */
  private async executeClaudeTask(
    task: ClaudeTask,
    workerId: string
  ): Promise<ClaudeTaskResult> {
    const startTime = Date.now();

    try {
      logger.debug(`${workerId}: executing task ${task.id}`);

      // Claude CLI 실행 로직
      const { runCli } = await import("../utils/cli-runner.js");

      const model = task.model || this.config.defaultModel;
      const args = [
        "--model", model,
        ...(task.maxTurns ? ["--max-turns", task.maxTurns.toString()] : []),
        ...(task.additionalArgs || []),
        task.prompt
      ];

      const result = await runCli(this.config.claudeCliPath, args, {
        timeout: this.config.timeout,
      });

      const duration = Date.now() - startTime;

      if (result.exitCode !== 0) {
        throw new Error(`Claude CLI failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      return {
        taskId: task.id,
        workerId,
        output: result.stdout,
        success: true,
        duration,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      logger.error(`${workerId}: task ${task.id} failed: ${errorMessage}`);

      return {
        taskId: task.id,
        workerId,
        output: "",
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * 태스크를 워커 풀에 제출한다.
   */
  async submitTask(task: ClaudeTask): Promise<ClaudeTaskResult> {
    logger.debug(`Submitting task ${task.id} to worker pool`);
    return this.pool.submit(task);
  }

  /**
   * 여러 태스크를 병렬로 실행한다.
   */
  async submitTasks(tasks: ClaudeTask[]): Promise<ClaudeTaskResult[]> {
    logger.info(`Submitting ${tasks.length} tasks for parallel execution`);

    const promises = tasks.map(task => this.submitTask(task));
    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        const task = tasks[index];
        const errorMessage = getErrorMessage(result.reason);
        logger.error(`Task ${task.id} rejected: ${errorMessage}`);

        return {
          taskId: task.id,
          workerId: "unknown",
          output: "",
          success: false,
          error: errorMessage,
          duration: 0,
        };
      }
    });
  }

  /**
   * 워커 풀의 현재 상태를 반환한다.
   */
  getPoolStatus() {
    return this.pool.getStatus();
  }

  /**
   * 활성 워커 목록을 반환한다.
   */
  getWorkers() {
    return this.pool.getWorkers();
  }

  /**
   * 최대 워커 수를 변경한다.
   */
  setMaxWorkers(count: number): void {
    logger.info(`Updating max workers from ${this.config.maxWorkers} to ${count}`);
    this.config.maxWorkers = count;
    this.pool.setMaxWorkers(count);
  }

  /**
   * Coordinator를 종료한다.
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    logger.info("Shutting down Coordinator");
    await this.pool.shutdown(timeoutMs);
    logger.info("Coordinator shutdown complete");
  }
}