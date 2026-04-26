import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { JobStore } from "./job-store.js";
import type { Job, DiagnosisReport, UserSummary } from "../types/pipeline.js";
import type { ProjectErrorTracker } from "./project-error-tracker.js";
import type { TaskFactory } from "../tasks/task-factory.js";
import type { AQMTask } from "../tasks/aqm-task.js";

const logger = getLogger();

export type JobHandler = (
  job: Job
) => Promise<{
  prUrl?: string;
  error?: string;
  diagnosis?: DiagnosisReport;
  userSummary?: UserSummary;
}>;

/**
 * 잡 한 건의 실행/결과 처리 책임 (Plan C #C10 — Phase 2).
 *
 * 이전: `JobQueue.executeJob` private 메서드. handler 호출, store 갱신, project error
 *      tracking, stuckAborted/cancelled 세트 정리, finally 단계의 running/repo 카운터
 *      해제까지 한 메서드에서 담당했다.
 * 이후: 본 클래스가 실행 흐름과 결과 분기만 담당한다. 공유 상태(running/runningByRepo
 *      카운터, processNext 호출)는 `onJobFinished` 콜백을 통해 JobQueue가 책임진다.
 */
export interface JobLifecycleDeps {
  store: JobStore;
  handler: JobHandler;
  taskFactory?: TaskFactory;
  errorTracker: ProjectErrorTracker;
  /** JobQueue가 소유하는 active task 추적 Map. cancel()이 동일 Map을 참조한다. */
  activeTasks: Map<string, AQMTask>;
  /** StuckJobMonitor 콜백/JobLifecycle 사이에서 공유되는 stuck-abort 플래그. */
  stuckAborted: Set<string>;
  /** JobQueue.cancel과 공유되는 cancel 플래그. */
  cancelled: Set<string>;
  /**
   * 잡 종료 시(성공/실패/취소/예외 모두 포함) 호출. JobQueue가 running.delete +
   * removeJobFromRepo + processNext schedule을 처리한다.
   */
  onJobFinished: (jobId: string, repo: string) => void;
}

export class JobLifecycle {
  constructor(private readonly deps: JobLifecycleDeps) {}

  async execute(job: Job): Promise<void> {
    try {
      // Stuck monitor가 이미 abort 신호를 보낸 잡은 handler를 돌리지 않는다.
      if (this.deps.stuckAborted.has(job.id)) {
        this.deps.stuckAborted.delete(job.id);
        return;
      }

      let result: {
        prUrl?: string;
        error?: string;
        diagnosis?: DiagnosisReport;
        userSummary?: UserSummary;
      };

      if (this.deps.taskFactory) {
        const task = this.deps.taskFactory.createTask(job);
        this.deps.activeTasks.set(job.id, task);
        try {
          result = await (
            task as unknown as {
              run(): Promise<{ prUrl?: string; error?: string }>;
            }
          ).run();
        } finally {
          this.deps.activeTasks.delete(job.id);
        }
      } else {
        result = await this.deps.handler(job);
      }

      // handler 실행 도중 stuck checker가 발화했을 수 있다 — 결과 적용 전 재확인.
      const wasStuckAborted = this.deps.stuckAborted.has(job.id);
      if (wasStuckAborted) {
        this.deps.stuckAborted.delete(job.id);
        logger.warn(
          `Job ${job.id} handler completed after stuck-abort — updating status but not tracking project metrics`
        );
      }

      if (this.deps.cancelled.has(job.id)) {
        this.deps.cancelled.delete(job.id);
        // cancel()이 이미 cancelled 상태로 update했으므로 추가 처리 없음.
      } else if (result.error) {
        this.deps.store.update(job.id, {
          status: "failure",
          completedAt: new Date().toISOString(),
          error: result.error,
          ...(result.diagnosis ? { diagnosis: result.diagnosis } : {}),
          ...(result.userSummary ? { userSummary: result.userSummary } : {}),
        });
        if (!wasStuckAborted) {
          this.deps.errorTracker.trackFailure(job.repo);
        }
      } else if (result.prUrl) {
        this.deps.store.update(job.id, {
          status: "success",
          completedAt: new Date().toISOString(),
          prUrl: result.prUrl,
        });
        if (!wasStuckAborted) {
          this.deps.errorTracker.trackSuccess(job.repo);
        }
      } else {
        this.deps.store.update(job.id, {
          status: "failure",
          completedAt: new Date().toISOString(),
          error: "Pipeline completed but no PR was created",
        });
        if (!wasStuckAborted) {
          this.deps.errorTracker.trackFailure(job.repo);
        }
      }
    } catch (error: unknown) {
      this.deps.store.update(job.id, {
        status: "failure",
        completedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      });
      this.deps.errorTracker.trackFailure(job.repo);
    } finally {
      this.deps.onJobFinished(job.id, job.repo);
    }
  }
}
