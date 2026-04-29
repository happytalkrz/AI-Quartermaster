import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { ConfigProvider } from "../config/config-provider.js";
import type { ProjectErrorState } from "../types/config.js";

const logger = getLogger();

const DEFAULT_PAUSE_THRESHOLD = 3;
const DEFAULT_PAUSE_DURATION_MS = 30 * 60 * 1000; // 30분

/**
 * 프로젝트별 연속 실패를 추적하고, 임계값 초과 시 일시 정지(pause)를 적용한다.
 *
 * Plan C #C6에서 `JobQueue` module-level `projectErrorState` Map과 4개 메서드
 * (isProjectPaused/pauseProject/resumeProject/getProjectStatus + private trackProjectFailure/Success)를
 * 단일 클래스로 응집. ConfigProvider를 명시적으로 주입받아 `process.cwd()` 의존을 제거한다.
 */
export class ProjectErrorTracker {
  private readonly state = new Map<string, ProjectErrorState>();
  private configProvider?: ConfigProvider;

  /**
   * @param configProvider 프로젝트별 pause threshold/duration을 읽기 위한 의존성.
   *                       미주입 시(테스트 환경 등) 기본값(threshold 3, duration 30분)을 사용한다.
   *                       지연 주입은 `setConfigProvider`로 가능.
   */
  constructor(configProvider?: ConfigProvider) {
    this.configProvider = configProvider;
  }

  /**
   * 런타임 시점에 ConfigProvider를 주입한다. JobQueue가 post-construction
   * setDependencies로 의존성을 주입하는 패턴을 지원한다.
   */
  setConfigProvider(provider: ConfigProvider): void {
    this.configProvider = provider;
  }

  /**
   * 프로젝트가 현재 일시 정지 상태인지 확인. 만료된 정지는 자동 해제한다.
   */
  isProjectPaused(repo: string): boolean {
    const errorState = this.state.get(repo);
    if (!errorState || !errorState.pausedUntil) {
      return false;
    }

    if (Date.now() >= errorState.pausedUntil) {
      this.resumeProject(repo);
      return false;
    }

    return true;
  }

  /**
   * 명시적으로 프로젝트를 일시 정지한다. 연속 실패 카운터에는 영향 없다.
   */
  pauseProject(repo: string, durationMs: number): void {
    const errorState = this.state.get(repo) || this.createEmptyState();
    errorState.pausedUntil = Date.now() + durationMs;
    this.state.set(repo, errorState);
    logger.warn(
      `Project ${repo} manually paused for ${Math.round(durationMs / 1000)}s`
    );
  }

  /**
   * 일시 정지를 해제한다. 카운터는 유지되며 trackSuccess로 별도 리셋한다.
   */
  resumeProject(repo: string): void {
    const errorState = this.state.get(repo);
    if (errorState) {
      errorState.pausedUntil = null;
      this.state.set(repo, errorState);
      logger.info(`Project ${repo} resumed`);
    }
  }

  getProjectStatus(repo: string): ProjectErrorState | null {
    return this.state.get(repo) || null;
  }

  /**
   * 실패를 기록한다. 임계값 도달 시 자동으로 pause를 적용한다.
   * pauseThreshold/pauseDurationMs는 config의 프로젝트 설정에서 가져온다.
   */
  trackFailure(repo: string): void {
    let project: { pauseThreshold?: number; pauseDurationMs?: number } | undefined;
    if (this.configProvider) {
      try {
        const config = this.configProvider.current();
        project = config?.projects?.find(p => p.repo === repo);
      } catch (error: unknown) {
        // config 로딩 실패 시(테스트 환경 등) 기본값으로 진행
        logger.debug(
          `Failed to load config for project failure tracking: ${getErrorMessage(error)}`
        );
      }
    }

    const pauseThreshold = project?.pauseThreshold || DEFAULT_PAUSE_THRESHOLD;
    const pauseDurationMs = project?.pauseDurationMs || DEFAULT_PAUSE_DURATION_MS;

    const errorState = this.state.get(repo) || this.createEmptyState();
    errorState.consecutiveFailures++;
    errorState.lastFailureAt = Date.now();

    if (errorState.consecutiveFailures >= pauseThreshold) {
      errorState.pausedUntil = Date.now() + pauseDurationMs;
      logger.error(
        `Project ${repo} paused for ${Math.round(pauseDurationMs / 60000)}min after ${errorState.consecutiveFailures} consecutive failures`
      );
    } else {
      logger.warn(
        `Project ${repo} failure count: ${errorState.consecutiveFailures}/${pauseThreshold}`
      );
    }

    this.state.set(repo, errorState);
  }

  /**
   * 성공을 기록한다. 연속 실패 카운터를 리셋하며, 수동 pausedUntil은 유지한다.
   */
  trackSuccess(repo: string): void {
    const errorState = this.state.get(repo);
    if (errorState && errorState.consecutiveFailures > 0) {
      logger.info(
        `Project ${repo} success - resetting failure count (was ${errorState.consecutiveFailures})`
      );
      errorState.consecutiveFailures = 0;
      errorState.lastFailureAt = null;
      // pausedUntil은 그대로 두어 수동 pauseProject 효과를 보존
      this.state.set(repo, errorState);
    }
  }

  /**
   * 모든 프로젝트 상태를 비운다. 데몬 재시작 시 사용.
   */
  clear(): void {
    this.state.clear();
  }

  private createEmptyState(): ProjectErrorState {
    return {
      consecutiveFailures: 0,
      pausedUntil: null,
      lastFailureAt: null,
    };
  }
}
