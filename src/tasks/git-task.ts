import { randomUUID } from "crypto";
import { AQMTask, TaskStatus, AQMTaskSummary, BaseTaskOptions } from "./aqm-task.js";
import type { GitConfig, PrConfig, GhCliConfig } from "../types/config.js";
import type { Plan, PhaseResult } from "../types/pipeline.js";
import { syncBaseBranch, createWorkBranch, pushBranch } from "../git/branch-manager.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { createDraftPR } from "../github/pr-creator.js";
import { createCheckpoint, rollbackToCheckpoint } from "../safety/rollback-manager.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

/**
 * PR 생성을 위한 옵션 (선택적)
 */
export interface GitTaskPrOptions {
  /** PR 설정 */
  prConfig: PrConfig;
  /** gh CLI 설정 */
  ghConfig: GhCliConfig;
  /** GitHub 레포지토리 (owner/repo) */
  repo: string;
  /** 구현 계획 */
  plan: Plan;
  /** 페이즈별 실행 결과 */
  phaseResults: PhaseResult[];
  /** 프롬프트 디렉토리 경로 */
  promptsDir: string;
  /** 드라이런 여부 */
  dryRun?: boolean;
}

/**
 * Git 작업 실행을 위한 옵션
 */
export interface GitTaskOptions extends BaseTaskOptions {
  /** Git 설정 */
  gitConfig: GitConfig;
  /** 이슈 번호 */
  issueNumber: number;
  /** 이슈 제목 (브랜치명 생성에 사용) */
  issueTitle: string;
  /** 작업 디렉토리 */
  cwd: string;
  /** PR 생성 옵션 (제공 시 PR 생성 수행) */
  prOptions?: GitTaskPrOptions;
  /** 실패 시 자동 롤백 여부 (기본값: false) */
  autoRollback?: boolean;
}

/**
 * Git 작업 실행 결과
 */
export interface GitTaskResult {
  /** 작업 성공 여부 */
  success: boolean;
  /** 생성된 브랜치명 */
  branchName?: string;
  /** 커밋 해시 */
  commitHash?: string;
  /** PR URL */
  prUrl?: string;
  /** 에러 메시지 */
  error?: string;
  /** 롤백된 체크포인트 해시 */
  rolledBackTo?: string;
  /** 실행 소요 시간 (밀리초) */
  durationMs: number;
}

/**
 * Git branch/commit/PR 작업을 래핑하는 AQMTask 구현체
 */
export class GitTask implements AQMTask {
  public readonly id: string;
  public readonly type = "git" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _result?: GitTaskResult;
  private _abortController: AbortController = new AbortController();
  private readonly _options: GitTaskOptions;

  constructor(options: GitTaskOptions) {
    this.id = options.id ?? randomUUID();
    this._options = { ...options, id: this.id };
  }

  get status(): TaskStatus {
    return this._status;
  }

  async run(): Promise<GitTaskResult> {
    if (this._status !== TaskStatus.PENDING) {
      throw new Error(`Task ${this.id} is already in ${this._status} state`);
    }

    this.setRunning();
    const logger = getLogger();
    const { gitConfig, issueNumber, issueTitle, cwd, autoRollback } = this._options;

    // Create checkpoint before any git operations
    let checkpointHash: string | undefined;
    try {
      checkpointHash = await createCheckpoint({ cwd, gitPath: gitConfig.gitPath });
      logger.info(`[GitTask] Checkpoint created: ${checkpointHash.slice(0, 8)} for issue #${issueNumber}`);
    } catch (err: unknown) {
      logger.warn(`[GitTask] Could not create checkpoint: ${getErrorMessage(err)}`);
    }

    try {
      // Step 1: Sync base branch
      if (this._abortController.signal.aborted) {
        this.setFailed("Task was killed before sync");
        return this._result!;
      }
      logger.info(`[GitTask] Syncing base branch for issue #${issueNumber}`);
      await syncBaseBranch(gitConfig, { cwd });

      // Step 2: Create work branch
      if (this._abortController.signal.aborted) {
        this.setFailed("Task was killed before branch creation");
        return this._result!;
      }
      logger.info(`[GitTask] Creating work branch for issue #${issueNumber}`);
      const { workBranch } = await createWorkBranch(gitConfig, issueNumber, issueTitle, { cwd });

      // Step 3: Auto-commit if dirty
      if (this._abortController.signal.aborted) {
        this.setFailed("Task was killed before commit");
        return this._result!;
      }
      logger.info(`[GitTask] Auto-committing changes for issue #${issueNumber}`);
      const commitMsg = `[#${issueNumber}] ${issueTitle}`;
      const commitHash = await autoCommitIfDirty(gitConfig.gitPath, cwd, commitMsg);

      // Step 4: Push branch
      if (this._abortController.signal.aborted) {
        this.setFailed("Task was killed before push");
        return this._result!;
      }
      logger.info(`[GitTask] Pushing branch ${workBranch}`);
      await pushBranch(gitConfig, workBranch, { cwd });

      // Step 5: Create PR (optional)
      let prUrl: string | undefined;
      const { prOptions } = this._options;
      if (prOptions) {
        if (this._abortController.signal.aborted) {
          this.setFailed("Task was killed before PR creation");
          return this._result!;
        }
        logger.info(`[GitTask] Creating PR for issue #${issueNumber}`);
        const prResult = await createDraftPR(
          prOptions.prConfig,
          prOptions.ghConfig,
          {
            issueNumber,
            issueTitle,
            repo: prOptions.repo,
            plan: prOptions.plan,
            phaseResults: prOptions.phaseResults,
            branchName: workBranch,
            baseBranch: gitConfig.defaultBaseBranch,
          },
          {
            cwd,
            promptsDir: prOptions.promptsDir,
            dryRun: prOptions.dryRun,
          }
        );
        if (prResult) {
          prUrl = prResult.url;
          logger.info(`[GitTask] PR created: ${prUrl}`);
        } else {
          logger.warn(`[GitTask] PR creation returned null for issue #${issueNumber}`);
        }
      }

      const durationMs = Date.now() - this._startedAt!.getTime();
      const result: GitTaskResult = {
        success: true,
        branchName: workBranch,
        commitHash,
        prUrl,
        durationMs,
      };
      this.setCompleted(result);
      logger.info(`[GitTask] Completed for issue #${issueNumber}: branch=${workBranch}`);
      return result;
    } catch (err: unknown) {
      const error = getErrorMessage(err);
      logger.error(`[GitTask] Failed for issue #${issueNumber}: ${error}`);

      let rolledBackTo: string | undefined;
      if (autoRollback && checkpointHash) {
        try {
          await rollbackToCheckpoint(checkpointHash, { cwd, gitPath: gitConfig.gitPath });
          rolledBackTo = checkpointHash;
          logger.info(`[GitTask] Rolled back to checkpoint ${checkpointHash.slice(0, 8)}`);
        } catch (rollbackErr: unknown) {
          logger.error(`[GitTask] Rollback failed: ${getErrorMessage(rollbackErr)}`);
        }
      }

      this.setFailed(error, rolledBackTo);
      return this._result!;
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) {
      return;
    }

    this._abortController.abort();
    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();
  }

  toJSON(): AQMTaskSummary {
    const durationMs = this._completedAt && this._startedAt
      ? this._completedAt.getTime() - this._startedAt.getTime()
      : undefined;

    return {
      id: this.id,
      type: this.type,
      status: this.status,
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
      durationMs,
      metadata: {
        ...this._options.metadata,
        issueNumber: this._options.issueNumber,
        issueTitle: this._options.issueTitle,
        branchName: this._result?.branchName,
        commitHash: this._result?.commitHash,
        prUrl: this._result?.prUrl,
        success: this._result?.success,
      },
    };
  }

  getResult(): GitTaskResult | undefined {
    return this._result;
  }

  protected setRunning(): void {
    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date();
  }

  protected setCompleted(result: GitTaskResult): void {
    this._result = result;
    this._completedAt = new Date();
    this._status = result.success ? TaskStatus.SUCCESS : TaskStatus.FAILED;
  }

  protected setFailed(error: string, rolledBackTo?: string): void {
    const durationMs = this._startedAt
      ? Date.now() - this._startedAt.getTime()
      : 0;
    this._result = { success: false, error, rolledBackTo, durationMs };
    this._completedAt = new Date();
    this._status = TaskStatus.FAILED;
  }

  protected get options(): GitTaskOptions {
    return this._options;
  }

  protected get abortSignal(): AbortSignal {
    return this._abortController.signal;
  }
}
