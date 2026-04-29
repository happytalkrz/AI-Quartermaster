import type { JobStore } from "./job-store.js";
import type { StuckThresholdConfig } from "../types/config.js";
import { isClaudeProcessAlive, getLastActivityMs } from "../claude/claude-runner.js";
import { checkJobStuck } from "./stuck-detector.js";
import { Job } from "../types/pipeline.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/**
 * 주기적으로 stuck 잡을 탐지해 콜백을 호출한다 (Plan C #C10 — Phase 1).
 *
 * 이전: `JobQueue.checkStuckJobs` private 메서드. running Set / stuckAborted Set /
 *      store / processNext에 깊이 얽혀 있었다.
 * 이후: 본 모니터가 store + 외부 콜백 두 가지 의존성만 갖고, JobQueue는 콜백에서
 *      자체 상태(running/stuckAborted)를 mutate한다.
 */
export interface StuckJobMonitorOptions {
  store: JobStore;
  stuckTimeoutMs: number;
  stuckThresholds?: StuckThresholdConfig;
  /** 현재 실행 중인 잡 ID iterable. 매 체크마다 호출되어 최신 상태를 가져온다. */
  getRunningJobIds: () => Iterable<string>;
  /** StoreJob → Job 변환기. JobQueue 내부 변환 헬퍼를 그대로 주입. */
  toJob: (storeJob: import("./job-store.js").Job) => Job;
  /** stuck으로 판정됐을 때 호출. JobQueue에서 store update + running 제거 + processNext schedule을 처리한다. */
  onStuckDetected: (jobId: string, reason: string) => void;
  /** 체크 주기. 기본 60초. */
  checkIntervalMs?: number;
}

const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

export class StuckJobMonitor {
  private interval?: ReturnType<typeof setInterval>;

  constructor(private readonly opts: StuckJobMonitorOptions) {}

  start(): void {
    this.stop();
    this.interval = setInterval(
      () => this.checkStuckJobs(),
      this.opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /**
   * 외부에서 명시적으로 한 차례 stuck 점검을 트리거한다 (테스트/긴급 점검).
   */
  runOnce(): void {
    this.checkStuckJobs();
  }

  private checkStuckJobs(): void {
    const thresholds: StuckThresholdConfig = this.opts.stuckThresholds ?? {
      defaultMs: this.opts.stuckTimeoutMs,
      planGenerationMs: this.opts.stuckTimeoutMs,
      implementationMs: this.opts.stuckTimeoutMs,
      reviewMs: this.opts.stuckTimeoutMs,
      verificationMs: this.opts.stuckTimeoutMs,
      publishMs: this.opts.stuckTimeoutMs,
      activityThresholdMs: DEFAULT_ACTIVITY_THRESHOLD_MS,
    };

    const processAlive = isClaudeProcessAlive();
    const lastActivityMs = getLastActivityMs();

    for (const jobId of this.opts.getRunningJobIds()) {
      const storeJob = this.opts.store.get(jobId);
      if (!storeJob) continue;

      const job = this.opts.toJob(storeJob);
      const result = checkJobStuck(job, thresholds, { processAlive, lastActivityMs });

      logger.debug(
        `StuckCheck job=${jobId} step=${job.currentStep ?? "-"} category=${result.category} ` +
        `elapsed=${result.elapsedMs}ms threshold=${result.thresholdMs}ms isStuck=${result.isStuck} reason=${result.reason}`
      );

      if (!result.isStuck && result.reason !== "임계값 이내") {
        // 임계값은 초과했지만 아직 진행 중 — lastUpdatedAt 갱신으로 대기 연장
        if (result.reason.startsWith("Claude 활동 중")) {
          logger.info(
            `Job ${jobId} (${result.category}): ${Math.round(result.elapsedMs / 60000)}분 경과, ${result.reason} — 대기 연장`
          );
        } else {
          logger.debug(
            `Job ${jobId} (${result.category}): ${result.reason} — 대기 연장`
          );
        }
        this.opts.store.update(jobId, { lastUpdatedAt: new Date().toISOString() });
      } else if (result.isStuck) {
        logger.error(
          `Job ${jobId} (${result.category}): ${Math.round(result.elapsedMs / 60000)}분 경과 — ${result.reason}`
        );
        this.opts.onStuckDetected(jobId, result.reason);
      }
      // result.reason === "임계값 이내": 임계값 미달, 액션 없음
    }
  }
}
