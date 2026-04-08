import { getLogger } from "../utils/logger.js";
import { runCli } from "../utils/cli-runner.js";
import { JobStore } from "../queue/job-store.js";
import { JobQueue } from "../queue/job-queue.js";
import { AQConfig } from "../types/config.js";
import { checkPrConflict, commentOnIssue, listOpenPrs } from "../github/pr-creator.js";
import type { PrConflictInfo } from "../types/pipeline.js";
import { SelfUpdater, UpdateInfo } from "../update/self-updater.js";
import { getErrorMessage } from "../utils/error-utils.js";

const logger = getLogger();

interface RawIssue {
  number: number;
  title: string;
  labels: Array<{ name: string } | string>;
}

type UpdateAvailableCallback = (updateInfo: UpdateInfo) => void | Promise<void>;

export class IssuePoller {
  private config: AQConfig;
  private store: JobStore;
  private queue: JobQueue;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private notifiedPrs = new Set<string>(); // 알림한 PR 추적 (repo:prNumber 형식)
  private selfUpdater: SelfUpdater | undefined;
  private onUpdateAvailable?: UpdateAvailableCallback;
  private pollingErrors = new Map<string, { count: number; lastErrorAt: number }>(); // repo -> error state

  constructor(
    config: AQConfig,
    store: JobStore,
    queue: JobQueue,
    onUpdateAvailable?: UpdateAvailableCallback
  ) {
    this.config = config;
    this.store = store;
    this.queue = queue;
    this.onUpdateAvailable = onUpdateAvailable;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`폴링 모드 시작 — 간격: ${this.config.general.pollingIntervalMs}ms`);
    // 첫 폴링 즉시 실행, 이후 interval 적용
    this.poll().then(() => this.scheduleNext()).catch(() => this.scheduleNext());
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info("폴링 모드 중지");
  }

  isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.poll();
      this.scheduleNext();
    }, this.config.general.pollingIntervalMs);
  }

  private async poll(): Promise<void> {
    const projects = this.config.projects ?? [];
    const triggerLabels = this.config.safety.allowedLabels;
    const ghPath = this.config.commands.ghCli.path;
    const ghTimeout = this.config.commands.ghCli.timeout;

    logger.debug(`폴링 사이클 시작 — 프로젝트 ${projects.length}개, 레이블: [${triggerLabels.join(", ")}]`);

    // Filter out paused projects (with safety check for mock compatibility)
    const activeProjects = projects.filter(p => {
      if (typeof this.queue.isProjectPaused !== 'function') {
        return true; // Skip filtering if method not available (e.g., in tests)
      }

      const isPaused = this.queue.isProjectPaused(p.repo);
      if (isPaused) {
        const status = this.queue.getProjectStatus?.(p.repo);
        const remainingMs = status?.pausedUntil ? status.pausedUntil - Date.now() : 0;
        logger.info(`프로젝트 ${p.repo} 일시 정지 중 (${Math.round(remainingMs / 1000)}초 남음, 연속실패: ${status?.consecutiveFailures || 0})`);
      }
      return !isPaused;
    });

    if (activeProjects.length < projects.length) {
      logger.warn(`일시 정지로 인해 ${projects.length - activeProjects.length}개 프로젝트 폴링 제외`);
    }

    // Check for updates if auto-update is enabled
    if (this.config.general.autoUpdate && this.onUpdateAvailable) {
      await this.checkForUpdates();
    }

    // 1. GitHub 이슈 폴링 (활성 프로젝트만)
    const issueTasks = activeProjects.flatMap(p => {
      const projectTimeout = p.commands?.ghCli?.timeout ?? ghTimeout;
      return triggerLabels.map(l => this.pollProjectLabel(p.repo, l, ghPath, projectTimeout));
    });
    await Promise.allSettled(issueTasks);

    // PR 충돌 체크 (활성 프로젝트만)
    const prTasks = activeProjects.map(p => this.checkProjectPrConflicts(p.repo, ghPath));
    await Promise.allSettled(prTasks);

    // 2. Failed job 감지 및 재큐잉
    await this.pollFailedJobs();
  }

  private async checkForUpdates(): Promise<void> {
    try {
      logger.debug("업데이트 확인 시작");
      if (!this.selfUpdater) {
        this.selfUpdater = new SelfUpdater(this.config.git, { cwd: process.cwd() });
      }
      const updateInfo = await this.selfUpdater.checkForUpdates();

      if (updateInfo.hasUpdates && this.onUpdateAvailable) {
        logger.info(`새 업데이트 감지 — ${updateInfo.currentHash.substring(0, 8)} -> ${updateInfo.remoteHash.substring(0, 8)}`);
        await this.onUpdateAvailable(updateInfo);
      }
    } catch (err: unknown) {
      logger.warn(`업데이트 확인 중 오류: ${getErrorMessage(err)}`);
    }
  }

  private async pollProjectLabel(
    repo: string,
    label: string,
    ghPath: string,
    timeout: number
  ): Promise<void> {
    let issues: RawIssue[];
    try {
      const result = await runCli(
        ghPath,
        [
          "issue", "list",
          "--repo", repo,
          "--label", label,
          "--state", "open",
          "--json", "number,title,labels",
          "--limit", "100",
        ],
        { timeout }
      );

      if (result.exitCode !== 0) {
        logger.warn(`이슈 목록 조회 실패 (${repo}, label=${label}): ${result.stderr || result.stdout}`);
        this.trackPollingFailure(repo, `이슈 목록 조회 실패 (exit ${result.exitCode})`);
        return;
      }

      issues = JSON.parse(result.stdout) as RawIssue[];
      // Polling success - reset error count
      this.resetPollingErrors(repo);
    } catch (err: unknown) {
      const errorMsg = getErrorMessage(err);
      logger.warn(`폴링 중 오류 (${repo}, label=${label}): ${errorMsg}`);
      this.trackPollingFailure(repo, errorMsg);
      return;
    }

    logger.debug(`${repo} — 레이블 "${label}" 오픈 이슈 ${issues.length}개 조회됨`);

    // 이슈 번호 오름차순 (오래된 이슈 먼저 처리)
    issues.sort((a, b) => a.number - b.number);

    for (const issue of issues) {
      if (this.store.shouldBlockRepickup(issue.number, repo)) {
        // 차단 이유를 상태별로 구분하여 로그 출력
        const existingJob = this.store.findAnyByIssue(issue.number, repo);
        if (existingJob) {
          if (existingJob.status === "running" || existingJob.status === "queued") {
            logger.debug(`이슈 #${issue.number} (${repo}) — 재픽업 차단 (${existingJob.status} 상태 잡 처리 중), 건너뜀`);
          } else if (existingJob.status === "success") {
            logger.debug(`이슈 #${issue.number} (${repo}) — 재픽업 차단 (성공 완료된 잡 존재), 건너뜀`);
          } else {
            logger.debug(`이슈 #${issue.number} (${repo}) — 재픽업 차단 (${existingJob.status} 상태 잡 존재), 건너뜀`);
          }
        } else {
          logger.debug(`이슈 #${issue.number} (${repo}) — 재픽업 차단, 건너뜀`);
        }
        continue;
      }
      logger.info(`새 이슈 발견 — #${issue.number} "${issue.title}" (${repo}), 큐에 추가`);
      this.queue.enqueue(issue.number, repo);
    }
  }

  private async checkProjectPrConflicts(repo: string, ghPath: string): Promise<void> {
    try {
      // 오픈 PR 목록 조회
      const prs = await listOpenPrs(repo, { ghPath });
      if (!prs || prs.length === 0) {
        logger.debug(`${repo} — 체크할 오픈 PR 없음`);
        return;
      }

      logger.debug(`${repo} — 오픈 PR ${prs.length}개 충돌 체크 시작`);

      // 각 PR에 대해 충돌 체크
      for (const pr of prs) {
        const prKey = `${repo}:${pr.number}`;

        // 이미 알림한 PR은 스킵
        if (this.notifiedPrs.has(prKey)) {
          logger.debug(`PR #${pr.number} (${repo}) — 이미 알림함, 건너뜀`);
          continue;
        }

        // 충돌 체크
        const conflictInfo = await checkPrConflict(pr.number, repo, { ghPath });
        if (conflictInfo) {
          // 충돌 감지 시 이슈에 코멘트 작성
          const conflictMessage = this.buildConflictMessage(conflictInfo);

          // PR과 연결된 이슈 번호 추출 시도 (제목에서 #123 패턴 찾기)
          const issueNumberMatch = pr.title.match(/#(\d+)/);
          const issueNumber = issueNumberMatch ? parseInt(issueNumberMatch[1], 10) : null;

          if (issueNumber) {
            const commentSuccess = await commentOnIssue(
              issueNumber,
              repo,
              conflictMessage,
              { ghPath }
            );

            if (commentSuccess) {
              logger.info(`PR #${pr.number} 충돌 알림 완료 — 이슈 #${issueNumber}에 코멘트 작성`);
              this.notifiedPrs.add(prKey);
            } else {
              logger.warn(`PR #${pr.number} 충돌 알림 실패 — 이슈 #${issueNumber} 코멘트 작성 실패`);
            }
          } else {
            logger.warn(`PR #${pr.number} 충돌 감지되었지만 연결된 이슈 번호를 찾을 수 없음: "${pr.title}"`);
          }
        } else {
          logger.debug(`PR #${pr.number} (${repo}) — 충돌 없음`);
        }
      }
    } catch (err: unknown) {
      logger.warn(`${repo} PR 충돌 체크 중 오류: ${getErrorMessage(err)}`);
    }
  }

  private buildConflictMessage(conflictInfo: PrConflictInfo): string {
    const { prNumber, conflictFiles, detectedAt, mergeStatus } = conflictInfo;

    const filesList = conflictFiles.length > 0
      ? `**충돌 파일(들)**:\n${conflictFiles.map(f => `- \`${f}\``).join("\n")}\n\n`
      : "";

    return `🚨 **PR #${prNumber} 머지 충돌 감지**

**상태**: ${mergeStatus}
**감지 시간**: ${detectedAt}

${filesList}베이스 브랜치의 변경으로 인해 이 PR에서 머지 충돌이 발생했습니다. 충돌을 해결한 후 PR을 업데이트해 주세요.

_자동 생성된 알림 — AQM PR 모니터링_`;
  }

  private async pollFailedJobs(): Promise<void> {
    try {
      const failedJobs = this.store.findFailedJobsForRetry();

      if (failedJobs.length === 0) {
        logger.debug("재시도할 실패 job 없음");
        return;
      }

      logger.info(`실패 job ${failedJobs.length}개 발견, 재큐잉 시작`);

      for (const job of failedJobs) {
        logger.info(`실패 job 재큐잉 — #${job.issueNumber} "${job.repo}" (job: ${job.id})`);

        // enqueue 호출 시 기존 failed job은 자동으로 아카이브되고 정리됨
        const newJob = this.queue.enqueue(job.issueNumber, job.repo, undefined, true);

        if (newJob) {
          logger.info(`재큐잉 성공 — 새 job: ${newJob.id}`);
        } else {
          logger.warn(`재큐잉 실패 — #${job.issueNumber} (${job.repo})`);
        }
      }
    } catch (err: unknown) {
      logger.warn(`Failed job 폴링 중 오류: ${getErrorMessage(err)}`);
    }
  }

  /**
   * Tracks a polling failure for a project and pauses the project if threshold is reached.
   */
  private trackPollingFailure(repo: string, errorMsg: string): void {
    const project = this.config?.projects?.find(p => p.repo === repo);

    const pauseThreshold = project?.pauseThreshold || 3;
    const pauseDurationMs = project?.pauseDurationMs || 30 * 60 * 1000; // 30분 기본값

    const now = Date.now();
    const errorState = this.pollingErrors.get(repo) || { count: 0, lastErrorAt: 0 };

    // Reset count if last error was more than 1 hour ago (indicates intermittent issues)
    if (now - errorState.lastErrorAt > 60 * 60 * 1000) {
      errorState.count = 0;
    }

    errorState.count++;
    errorState.lastErrorAt = now;
    this.pollingErrors.set(repo, errorState);

    logger.warn(`프로젝트 ${repo} 폴링 실패 (${errorState.count}/${pauseThreshold}): ${errorMsg}`);

    if (errorState.count >= pauseThreshold) {
      // Pause the project using JobQueue's pause mechanism (with safety check)
      if (typeof this.queue.pauseProject === 'function') {
        this.queue.pauseProject(repo, pauseDurationMs);
        logger.error(
          `프로젝트 ${repo} 폴링 연속 실패로 일시 정지 — ${Math.round(pauseDurationMs / 60000)}분간 폴링 제외`
        );
      } else {
        logger.error(
          `프로젝트 ${repo} 폴링 연속 실패 ${errorState.count}회 도달 — 일시 정지 기능 사용 불가 (테스트 모드)`
        );
      }

      // Reset polling error count after pause
      this.pollingErrors.delete(repo);
    }
  }

  /**
   * Resets polling error count for a project on successful polling.
   */
  private resetPollingErrors(repo: string): void {
    const errorState = this.pollingErrors.get(repo);
    if (errorState && errorState.count > 0) {
      logger.info(`프로젝트 ${repo} 폴링 성공 — 에러 카운트 리셋 (이전: ${errorState.count})`);
      this.pollingErrors.delete(repo);
    }
  }
}
