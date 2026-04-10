import cron from "node-cron";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { ScheduledTask, ScheduledTaskStatus } from "../types/automation.js";

export type TaskCallback = () => Promise<void> | void;

interface TaskEntry {
  task: ScheduledTask;
  cronJob: cron.ScheduledTask;
  callback: TaskCallback;
}

const logger = getLogger();

export class AutomationScheduler {
  private tasks = new Map<string, TaskEntry>();
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`AutomationScheduler 시작 — 등록된 태스크: ${this.tasks.size}개`);

    for (const [id, entry] of this.tasks) {
      if (entry.task.status !== "disabled") {
        entry.cronJob.start();
        logger.debug(`태스크 스케줄 시작 — id: ${id}, name: ${entry.task.name}`);
      }
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const [id, entry] of this.tasks) {
      entry.cronJob.stop();
      logger.debug(`태스크 스케줄 중지 — id: ${id}`);
    }

    logger.info("AutomationScheduler 중지");
  }

  isRunning(): boolean {
    return this.running;
  }

  addTask(task: ScheduledTask, callback: TaskCallback): void {
    if (this.tasks.has(task.id)) {
      logger.warn(`태스크 이미 존재 — id: ${task.id}, 덮어씁니다`);
      this.removeTask(task.id);
    }

    const { expression, timezone } = task.schedule;

    if (!cron.validate(expression)) {
      throw new Error(`유효하지 않은 cron 표현식 — id: ${task.id}, expression: "${expression}"`);
    }

    const cronJob = cron.schedule(
      expression,
      async () => {
        await this.runTask(task.id);
      },
      {
        scheduled: false,
        timezone,
      }
    );

    this.tasks.set(task.id, { task: { ...task }, cronJob, callback });
    logger.info(`태스크 등록 — id: ${task.id}, name: ${task.name}, schedule: ${expression}`);

    if (this.running && task.status !== "disabled") {
      cronJob.start();
      logger.debug(`스케줄러 실행 중 — 태스크 즉시 시작: ${task.id}`);
    }
  }

  removeTask(id: string): void {
    const entry = this.tasks.get(id);
    if (!entry) {
      logger.warn(`태스크 없음 — id: ${id}`);
      return;
    }

    entry.cronJob.stop();
    this.tasks.delete(id);
    logger.info(`태스크 제거 — id: ${id}, name: ${entry.task.name}`);
  }

  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id)?.task;
  }

  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).map(e => ({ ...e.task }));
  }

  getState(): { tasks: ScheduledTask[]; running: boolean } {
    return {
      tasks: this.getTasks(),
      running: this.running,
    };
  }

  private async runTask(id: string): Promise<void> {
    const entry = this.tasks.get(id);
    if (!entry) return;

    if (entry.task.status === "running") {
      logger.warn(`태스크 이미 실행 중 — id: ${id}, 건너뜀`);
      return;
    }

    this.updateTaskStatus(id, "running");
    const startedAt = Date.now();
    logger.info(`태스크 실행 시작 — id: ${id}, name: ${entry.task.name}`);

    try {
      await entry.callback();
      this.updateTaskAfterRun(id, startedAt, undefined);
      logger.info(`태스크 실행 완료 — id: ${id}, name: ${entry.task.name}`);
    } catch (err: unknown) {
      const errorMsg = getErrorMessage(err);
      this.updateTaskAfterRun(id, startedAt, errorMsg);
      logger.error(`태스크 실행 실패 — id: ${id}, name: ${entry.task.name}, error: ${errorMsg}`);
    }
  }

  private updateTaskStatus(id: string, status: ScheduledTaskStatus): void {
    const entry = this.tasks.get(id);
    if (!entry) return;
    entry.task.status = status;
  }

  private updateTaskAfterRun(id: string, startedAt: number, error: string | undefined): void {
    const entry = this.tasks.get(id);
    if (!entry) return;

    entry.task.lastRunAt = startedAt;
    entry.task.runCount++;
    entry.task.status = error ? "failed" : "idle";

    if (error) {
      entry.task.lastError = error;
    } else {
      entry.task.lastError = undefined;
    }
  }
}
