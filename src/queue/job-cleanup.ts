import { resolve } from "path";
import { loadCheckpoint, removeCheckpoint } from "../pipeline/errors/checkpoint.js";
import { removeWorktree } from "../git/worktree-manager.js";
import { deleteRemoteBranch } from "../git/branch-manager.js";
import { loadConfig } from "../config/loader.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { ConfigProvider } from "../config/config-provider.js";

const logger = getLogger();

/**
 * 실패한 잡의 worktree, 원격 브랜치, 체크포인트 정리를 담당한다.
 *
 * Plan C #C6 이전: `JobQueue.cleanupFailedJobArtifacts`가 fire-and-forget
 * (`Promise.resolve(...).catch()`)으로 worktree/브랜치 제거를 던지고 즉시 반환했다.
 * 후속 enqueue/retry가 정리 완료 전에 시작되면 worktree 충돌이 발생할 수 있었다.
 *
 * 본 서비스는 모든 정리 작업을 `await Promise.allSettled`로 묶어 후속 작업이 시작되기 전에
 * 정리 완료를 보장한다. 각 단계 실패는 로그만 남기고 다른 단계는 계속 진행한다.
 */
export class JobCleanupService {
  /**
   * @param aqRoot AQM root (cwd) 디렉토리
   * @param configProvider git config 조회용. 미주입 시 `loadConfig(aqRoot)` fallback.
   */
  constructor(
    private readonly aqRoot: string,
    private readonly configProvider?: ConfigProvider
  ) {}

  /**
   * 실패한 잡의 worktree·원격 브랜치·체크포인트를 정리한다.
   *
   * 호출 측은 본 메서드 완료 후 동일 issue의 enqueue/retry를 안전하게 시작할 수 있다.
   */
  async cleanupFailedJobArtifacts(issueNumber: number): Promise<void> {
    const dataDir = resolve(this.aqRoot, "data");

    let checkpoint = null;
    try {
      checkpoint = loadCheckpoint(dataDir, issueNumber);
    } catch (err: unknown) {
      logger.warn(
        `Failed to load checkpoint for cleanup of issue #${issueNumber}: ${getErrorMessage(err)}`
      );
    }

    const tasks: Promise<unknown>[] = [];
    if (checkpoint) {
      const config = this.configProvider?.current() ?? loadConfig(this.aqRoot);

      if (checkpoint.worktreePath) {
        const worktreePath = checkpoint.worktreePath;
        logger.info(`Cleaning up worktree: ${worktreePath}`);
        tasks.push(
          Promise.resolve(
            removeWorktree(config.git, worktreePath, { cwd: this.aqRoot, force: true })
          ).catch((err: unknown) => {
            logger.warn(
              `Failed to remove worktree ${worktreePath}: ${getErrorMessage(err)}`
            );
          })
        );
      }

      if (checkpoint.branchName) {
        const branchName = checkpoint.branchName;
        logger.info(`Deleting remote branch: ${branchName}`);
        tasks.push(
          Promise.resolve(
            deleteRemoteBranch(config.git, branchName, { cwd: this.aqRoot })
          ).catch((err: unknown) => {
            logger.warn(
              `Failed to delete remote branch ${branchName}: ${getErrorMessage(err)}`
            );
          })
        );
      }
    }

    // 체크포인트 제거는 항상 동기 시도 — 로드 실패한 경우에도 stale 체크포인트가 남으면 안 된다.
    // worktree/branch 정리(비동기)보다 먼저 실행해 후속 enqueue가 stale 체크포인트를 잡지 않도록 한다.
    try {
      logger.info(`Removing checkpoint for issue #${issueNumber}`);
      removeCheckpoint(dataDir, issueNumber);
    } catch (err: unknown) {
      logger.warn(
        `Failed to remove checkpoint for issue #${issueNumber}: ${getErrorMessage(err)}`
      );
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }
}
