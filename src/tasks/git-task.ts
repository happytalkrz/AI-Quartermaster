import { randomUUID } from "crypto";
import { AQMTask, TaskStatus, AQMTaskSummary, BaseTaskOptions } from "./aqm-task.js";
import type { GitConfig } from "../types/config.js";
import { syncBaseBranch, createWorkBranch, pushBranch } from "../git/branch-manager.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

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
    const { gitConfig, issueNumber, issueTitle, cwd } = this._options;

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

      const durationMs = Date.now() - this._startedAt!.getTime();
      const result: GitTaskResult = {
        success: true,
        branchName: workBranch,
        commitHash,
        durationMs,
      };
      this.setCompleted(result);
      logger.info(`[GitTask] Completed for issue #${issueNumber}: branch=${workBranch}`);
      return result;
    } catch (err: unknown) {
      const error = getErrorMessage(err);
      logger.error(`[GitTask] Failed for issue #${issueNumber}: ${error}`);
      this.setFailed(error);
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

  protected setFailed(error: string): void {
    const durationMs = this._startedAt
      ? Date.now() - this._startedAt.getTime()
      : 0;
    this._result = { success: false, error, durationMs };
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
