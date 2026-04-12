/**
 * TaskFactory — Job을 AQMTask로 변환하는 팩토리 인터페이스
 *
 * JobQueue의 기존 JobHandler 패턴 위에 추가되는 선택적 통합 레이어.
 * taskFactory가 없으면 기존 JobHandler 방식이 그대로 동작한다.
 */

import type { Job } from "../types/pipeline.js";
import type { AQMTask, AQMTaskSummary } from "./aqm-task.js";
import { TaskStatus } from "./aqm-task.js";

export type { AQMTask };

/**
 * Job을 AQMTask로 생성하는 팩토리 인터페이스
 */
export interface TaskFactory {
  createTask(job: Job): AQMTask;
}

/**
 * 기존 JobHandler 콜백을 AQMTask로 래핑하는 기본 구현체.
 * JobHandler가 있으나 TaskFactory가 필요할 때 사용.
 */
export class DefaultTaskFactory implements TaskFactory {
  private readonly handler: (job: Job) => Promise<{ prUrl?: string; error?: string }>;

  constructor(handler: (job: Job) => Promise<{ prUrl?: string; error?: string }>) {
    this.handler = handler;
  }

  createTask(job: Job): AQMTask {
    return new HandlerWrappedTask(job, this.handler);
  }
}

/**
 * JobHandler 콜백을 AQMTask 인터페이스로 감싸는 내부 구현체.
 * toJSON() / fromJSON() 직렬화를 지원한다.
 */
class HandlerWrappedTask implements AQMTask {
  public readonly id: string;
  public readonly type = "claude" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: string;
  private _completedAt?: string;
  private _abortController = new AbortController();
  private readonly _job: Job;
  private readonly _handler: (job: Job) => Promise<{ prUrl?: string; error?: string }>;

  constructor(
    job: Job,
    handler: (job: Job) => Promise<{ prUrl?: string; error?: string }>
  ) {
    this.id = job.id;
    this._job = job;
    this._handler = handler;
  }

  get status(): TaskStatus {
    return this._status;
  }

  async run(): Promise<{ prUrl?: string; error?: string }> {
    if (this._status !== TaskStatus.PENDING) {
      throw new Error(`Task ${this.id} is already ${this._status}`);
    }
    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date().toISOString();
    try {
      const result = await this._handler(this._job);
      this._completedAt = new Date().toISOString();
      this._status = result.error ? TaskStatus.FAILED : TaskStatus.SUCCESS;
      return result;
    } catch (err: unknown) {
      this._completedAt = new Date().toISOString();
      this._status = TaskStatus.FAILED;
      throw err;
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) return;
    this._abortController.abort();
    this._status = TaskStatus.KILLED;
    this._completedAt = new Date().toISOString();
  }

  toJSON(): AQMTaskSummary {
    return {
      id: this.id,
      type: this.type,
      status: this._status,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      durationMs:
        this._startedAt && this._completedAt
          ? new Date(this._completedAt).getTime() - new Date(this._startedAt).getTime()
          : undefined,
      metadata: {
        jobId: this._job.id,
        issueNumber: this._job.issueNumber,
        repo: this._job.repo,
      },
    };
  }

  /**
   * 직렬화된 태스크 요약에서 최소 정보를 복원.
   * handler는 외부에서 다시 주입해야 한다.
   */
  static fromJSON(
    data: AQMTaskSummary,
    job: Job,
    handler: (job: Job) => Promise<{ prUrl?: string; error?: string }>
  ): HandlerWrappedTask {
    const task = new HandlerWrappedTask(job, handler);
    // 이미 완료된 상태이면 복원 (재실행하지 않음)
    task._status = data.status;
    task._startedAt = data.startedAt;
    task._completedAt = data.completedAt;
    return task;
  }
}
