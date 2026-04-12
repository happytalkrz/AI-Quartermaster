import { randomUUID } from "crypto";
import { AQMTask, TaskStatus, type AQMTaskSummary, type BaseTaskOptions } from "./aqm-task.js";
import { getErrorMessage } from "../utils/error-utils.js";
import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
  deleteRemoteBranch,
  type BranchInfo
} from "../git/branch-manager.js";
import { autoCommitIfDirty, getHeadHash } from "../git/commit-helper.js";
import type { GitConfig } from "../types/config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export type GitOperationType = "branch" | "commit" | "push" | "pr";

export interface GitOperationOptions {
  /** Git 설정 */
  gitConfig: GitConfig;
  /** 작업 디렉토리 */
  cwd: string;
  /** 타임아웃 (밀리초) */
  timeout?: number;
}

export interface BranchOperationOptions extends GitOperationOptions {
  /** 이슈 번호 */
  issueNumber: number;
  /** 이슈 제목 */
  issueTitle: string;
}

export interface CommitOperationOptions extends GitOperationOptions {
  /** 커밋 메시지 */
  commitMessage: string;
}

export interface PushOperationOptions extends GitOperationOptions {
  /** 푸시할 브랜치명 */
  branchName: string;
}

export interface PrOperationOptions extends GitOperationOptions {
  /** 브랜치 정보 */
  branchInfo: BranchInfo;
  /** PR 제목 */
  title: string;
  /** PR 본문 */
  body: string;
}

export type GitTaskOperationOptions =
  | BranchOperationOptions
  | CommitOperationOptions
  | PushOperationOptions
  | PrOperationOptions;

export interface GitTaskOptions extends BaseTaskOptions {
  operation: GitOperationType;
  operationOptions: GitTaskOperationOptions;
}

export interface GitOperationResult {
  success: boolean;
  operation: GitOperationType;
  durationMs: number;
  data?: unknown;
  error?: string;
}

interface GitTaskState {
  branchCreated?: string;
  commitHash?: string;
  previousCommitHash?: string;
  remotePushed?: string;
  prNumber?: number;
}

/**
 * Git 작업(branch/commit/push/pr)을 수행하는 AQMTask 구현체
 * rollback 기능을 지원하여 실패 시 생성된 리소스를 정리함
 */
export class GitTask implements AQMTask {
  public readonly id: string;
  public readonly type = "git" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _result?: GitOperationResult;
  private readonly _options: GitTaskOptions;
  private _timeout?: NodeJS.Timeout;
  private _state: GitTaskState = {};

  constructor(options: GitTaskOptions) {
    this.id = options.id ?? randomUUID();
    this._options = { ...options, id: this.id };
  }

  get status(): TaskStatus {
    return this._status;
  }

  async run(): Promise<GitOperationResult> {
    if (this._status !== TaskStatus.PENDING) {
      throw new Error(`Task ${this.id} is already ${this._status} and cannot be run again`);
    }

    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date();

    // 타임아웃 설정
    if (this._options.operationOptions.timeout) {
      this._timeout = setTimeout(() => {
        this.kill().catch(err => logger.warn(`Failed to kill timed out task ${this.id}:`, err));
      }, this._options.operationOptions.timeout);
    }

    try {
      const result = await this._executeOperation();
      this._completedAt = new Date();
      this._status = result.success ? TaskStatus.SUCCESS : TaskStatus.FAILED;
      this._result = result;

      if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = undefined;
      }

      return result;
    } catch (err: unknown) {
      this._completedAt = new Date();
      this._status = TaskStatus.FAILED;
      const durationMs = this._completedAt.getTime() - (this._startedAt?.getTime() ?? 0);

      if (this._timeout) {
        clearTimeout(this._timeout);
        this._timeout = undefined;
      }

      this._result = {
        success: false,
        operation: this._options.operation,
        durationMs,
        error: getErrorMessage(err),
      };

      // 실패 시 롤백 시도
      await this._attemptRollback();
      throw err;
    }
  }

  private async _executeOperation(): Promise<GitOperationResult> {
    const startTime = this._startedAt?.getTime() ?? Date.now();
    const { operation, operationOptions } = this._options;

    let data: unknown;

    switch (operation) {
      case "branch":
        data = await this._executeBranchOperation(operationOptions as BranchOperationOptions);
        break;
      case "commit":
        data = await this._executeCommitOperation(operationOptions as CommitOperationOptions);
        break;
      case "push":
        data = await this._executePushOperation(operationOptions as PushOperationOptions);
        break;
      case "pr":
        throw new Error("PR operation not yet implemented");
      default:
        throw new Error(`Unknown operation type: ${operation}`);
    }

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      operation,
      durationMs,
      data,
    };
  }

  private async _executeBranchOperation(options: BranchOperationOptions): Promise<BranchInfo> {
    const { gitConfig, cwd, issueNumber, issueTitle } = options;

    // 베이스 브랜치 동기화
    await syncBaseBranch(gitConfig, { cwd });

    // 작업 브랜치 생성
    const branchInfo = await createWorkBranch(gitConfig, issueNumber, issueTitle, { cwd });

    // 상태 저장 (롤백용)
    this._state.branchCreated = branchInfo.workBranch;

    logger.info(`Git branch operation completed: ${branchInfo.workBranch}`);
    return branchInfo;
  }

  private async _executeCommitOperation(options: CommitOperationOptions): Promise<{ commitHash?: string; previousCommitHash: string }> {
    const { gitConfig, cwd, commitMessage } = options;

    // 이전 커밋 해시 저장 (롤백용)
    const previousCommitHash = await getHeadHash(gitConfig.gitPath, cwd);
    this._state.previousCommitHash = previousCommitHash;

    // 자동 커밋 실행
    const commitHash = await autoCommitIfDirty(gitConfig.gitPath, cwd, commitMessage);

    if (commitHash) {
      this._state.commitHash = commitHash;
      logger.info(`Git commit operation completed: ${commitHash}`);
    } else {
      logger.info("Git commit operation completed: no changes to commit");
    }

    return { commitHash, previousCommitHash };
  }

  private async _executePushOperation(options: PushOperationOptions): Promise<{ branchName: string }> {
    const { gitConfig, cwd, branchName } = options;

    // 브랜치 푸시
    await pushBranch(gitConfig, branchName, { cwd });

    // 상태 저장 (롤백용)
    this._state.remotePushed = branchName;

    logger.info(`Git push operation completed: ${branchName}`);
    return { branchName };
  }

  /**
   * 실패 시 생성된 리소스를 정리하는 롤백 로직
   */
  public async rollback(): Promise<void> {
    if (this._status === TaskStatus.SUCCESS) {
      logger.warn(`Task ${this.id} succeeded, rollback not needed`);
      return;
    }

    logger.info(`Starting rollback for git task ${this.id}...`);

    try {
      await this._attemptRollback();
      logger.info(`Rollback completed for git task ${this.id}`);
    } catch (err: unknown) {
      logger.error(`Rollback failed for git task ${this.id}:`, err);
      throw err;
    }
  }

  private async _attemptRollback(): Promise<void> {
    const { gitConfig, cwd } = this._options.operationOptions;

    // 원격 브랜치가 푸시되었다면 삭제
    if (this._state.remotePushed) {
      try {
        await deleteRemoteBranch(gitConfig, this._state.remotePushed, { cwd });
        logger.info(`Rolled back remote branch: ${this._state.remotePushed}`);
      } catch (err: unknown) {
        logger.warn(`Failed to rollback remote branch ${this._state.remotePushed}:`, err);
      }
    }

    // 커밋이 생성되었다면 이전 상태로 리셋
    if (this._state.commitHash && this._state.previousCommitHash) {
      try {
        const { runCli } = await import("../utils/cli-runner.js");
        const result = await runCli(gitConfig.gitPath, ["reset", "--hard", this._state.previousCommitHash], { cwd });
        if (result.exitCode === 0) {
          logger.info(`Rolled back commit: ${this._state.commitHash} -> ${this._state.previousCommitHash}`);
        } else {
          logger.warn(`Failed to rollback commit: ${result.stderr}`);
        }
      } catch (err: unknown) {
        logger.warn(`Failed to rollback commit ${this._state.commitHash}:`, err);
      }
    }

    // 로컬 브랜치가 생성되었다면 삭제 (단, 현재 체크아웃된 브랜치가 아닌 경우에만)
    if (this._state.branchCreated) {
      try {
        const { runCli } = await import("../utils/cli-runner.js");
        // 현재 브랜치 확인
        const currentBranch = await runCli(gitConfig.gitPath, ["branch", "--show-current"], { cwd });
        if (currentBranch.stdout.trim() !== this._state.branchCreated) {
          const result = await runCli(gitConfig.gitPath, ["branch", "-D", this._state.branchCreated], { cwd });
          if (result.exitCode === 0) {
            logger.info(`Rolled back local branch: ${this._state.branchCreated}`);
          } else {
            logger.warn(`Failed to rollback local branch: ${result.stderr}`);
          }
        } else {
          logger.warn(`Cannot delete current branch ${this._state.branchCreated}, manual cleanup required`);
        }
      } catch (err: unknown) {
        logger.warn(`Failed to rollback local branch ${this._state.branchCreated}:`, err);
      }
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) {
      return;
    }

    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = undefined;
    }

    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();

    // kill 시에도 롤백 시도
    await this._attemptRollback();

    logger.info(`Git task ${this.id} killed and rolled back`);
  }

  toJSON(): AQMTaskSummary {
    const durationMs =
      this._completedAt && this._startedAt
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
        operation: this._options.operation,
        success: this._result?.success,
        error: this._result?.error,
        data: this._result?.data,
        state: this._state,
      },
    };
  }

  getResult(): GitOperationResult | undefined {
    return this._result;
  }

  getState(): GitTaskState {
    return { ...this._state };
  }
}