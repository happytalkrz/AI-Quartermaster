import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AQMTask, TaskStatus, AQMTaskSummary, BaseTaskOptions, TaskLifecycleEvent, TaskEventListener, SerializedTask } from "./aqm-task.js";
import { syncBaseBranch, createWorkBranch, checkConflicts, attemptRebase, deleteRemoteBranch, pushBranch, type BranchInfo } from "../git/branch-manager.js";
import { autoCommitIfDirty, getHeadHash } from "../git/commit-helper.js";
import { createDraftPR, enableAutoMerge, type PrCreateResult, type PrContext } from "../github/pr-creator.js";
import type { GitConfig, PrConfig, GhCliConfig } from "../types/config.js";
import type { Plan, PhaseResult, UsageInfo } from "../types/pipeline.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export type GitOperationType = "branch" | "commit" | "push" | "pr" | "full-workflow";

export interface GitTaskResult {
  success: boolean;
  operation: GitOperationType;
  durationMs: number;
  branchInfo?: BranchInfo;
  commitHash?: string;
  prResult?: PrCreateResult;
  conflictInfo?: {
    hasConflicts: boolean;
    conflictFiles: string[];
  };
  error?: string;
  rollbackPerformed?: boolean;
  rollbackDetails?: string[];
}

export interface GitTaskOptions extends BaseTaskOptions {
  /** Git 작업 타입 */
  operation: GitOperationType;
  /** Git 설정 */
  gitConfig: GitConfig;
  /** 이슈 번호 */
  issueNumber?: number;
  /** 이슈 제목 */
  issueTitle?: string;
  /** 커밋 메시지 (commit 작업용) */
  commitMessage?: string;
  /** PR 설정 (pr 작업용) */
  prConfig?: PrConfig;
  /** GitHub CLI 설정 (pr 작업용) */
  ghConfig?: GhCliConfig;
  /** PR 컨텍스트 (pr 작업용) */
  prContext?: PrContext;
  /** 프롬프트 디렉토리 (pr 작업용) */
  promptsDir?: string;
  /** 드라이런 모드 */
  dryRun?: boolean;
  /** 브랜치 정보 (기존 브랜치 사용 시) */
  existingBranchInfo?: BranchInfo;
  /** 롤백 활성화 여부 */
  enableRollback?: boolean;
}

/**
 * Git 작업을 래핑하는 AQMTask 구현체
 * branch-manager, commit-helper, pr-creator의 기능을 통합 관리하고 롤백 기능 제공
 */
export class GitTask implements AQMTask {
  public readonly id: string;
  public readonly type = "git" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _result?: GitTaskResult;
  private readonly _options: GitTaskOptions;
  private readonly _emitter = new EventEmitter();
  private _rollbackData: {
    branchCreated?: string;
    worktreePath?: string;
    originalHead?: string;
  } = {};

  constructor(options: GitTaskOptions) {
    this.id = options.id || randomUUID();
    this._options = { ...options, id: this.id };
  }

  get status(): TaskStatus {
    return this._status;
  }

  on(event: TaskLifecycleEvent, listener: TaskEventListener): void {
    this._emitter.on(event, listener);
  }

  off(event: TaskLifecycleEvent, listener: TaskEventListener): void {
    this._emitter.off(event, listener);
  }

  once(event: TaskLifecycleEvent, listener: TaskEventListener): void {
    this._emitter.once(event, listener);
  }

  async run(): Promise<GitTaskResult> {
    if (this._status !== TaskStatus.PENDING) {
      throw new Error(`Task ${this.id} is already ${this._status} and cannot be run again`);
    }

    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date();
    this._emitter.emit("started");

    try {
      let result: GitTaskResult;

      switch (this._options.operation) {
        case "branch":
          result = await this._executeBranchOperation();
          break;
        case "commit":
          result = await this._executeCommitOperation();
          break;
        case "push":
          result = await this._executePushOperation();
          break;
        case "pr":
          result = await this._executePrOperation();
          break;
        case "full-workflow":
          result = await this._executeFullWorkflow();
          break;
        default:
          throw new Error(`Unsupported git operation: ${this._options.operation}`);
      }

      this._completedAt = new Date();
      this._status = result.success ? TaskStatus.SUCCESS : TaskStatus.FAILED;
      this._result = result;

      if (result.success) {
        this._emitter.emit("completed");
      } else {
        this._emitter.emit("failed");
      }

      return result;
    } catch (error) {
      this._completedAt = new Date();
      this._status = TaskStatus.FAILED;
      this._emitter.emit("failed");

      // 에러 발생 시 자동 롤백 실행
      if (this._options.enableRollback) {
        try {
          await this._performRollback();
        } catch (rollbackError) {
          logger.warn(`Rollback failed: ${rollbackError}`);
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this._result = {
        success: false,
        operation: this._options.operation,
        durationMs: this._completedAt.getTime() - (this._startedAt?.getTime() ?? 0),
        error: errorMessage,
      };

      throw error;
    }
  }

  private async _executeBranchOperation(): Promise<GitTaskResult> {
    const { gitConfig, issueNumber, issueTitle, cwd } = this._options;

    if (!issueNumber || !issueTitle || !cwd) {
      throw new Error("Branch operation requires issueNumber, issueTitle, and cwd");
    }

    const startTime = Date.now();

    // Sync base branch
    await syncBaseBranch(gitConfig, { cwd });

    // Create work branch
    const branchInfo = await createWorkBranch(gitConfig, issueNumber, issueTitle, { cwd });

    // Store for potential rollback
    this._rollbackData.branchCreated = branchInfo.workBranch;

    return {
      success: true,
      operation: "branch",
      durationMs: Date.now() - startTime,
      branchInfo,
    };
  }

  private async _executeCommitOperation(): Promise<GitTaskResult> {
    const { gitConfig, commitMessage, cwd } = this._options;

    if (!commitMessage || !cwd) {
      throw new Error("Commit operation requires commitMessage and cwd");
    }

    const startTime = Date.now();

    // Store original HEAD for rollback
    this._rollbackData.originalHead = await getHeadHash(gitConfig.gitPath, cwd);

    // Auto-commit if dirty
    const commitHash = await autoCommitIfDirty(gitConfig.gitPath, cwd, commitMessage);

    return {
      success: true,
      operation: "commit",
      durationMs: Date.now() - startTime,
      commitHash: commitHash || this._rollbackData.originalHead,
    };
  }

  private async _executePushOperation(): Promise<GitTaskResult> {
    const { gitConfig, existingBranchInfo, cwd } = this._options;

    if (!existingBranchInfo || !cwd) {
      throw new Error("Push operation requires existingBranchInfo and cwd");
    }

    const startTime = Date.now();

    // Check for conflicts before pushing
    const conflictInfo = await checkConflicts(gitConfig, existingBranchInfo.baseBranch, { cwd });

    if (conflictInfo.hasConflicts) {
      // Attempt rebase
      const rebaseResult = await attemptRebase(gitConfig, existingBranchInfo.baseBranch, { cwd });

      if (!rebaseResult.success) {
        return {
          success: false,
          operation: "push",
          durationMs: Date.now() - startTime,
          conflictInfo,
          error: rebaseResult.error,
        };
      }
    }

    // Push branch
    await pushBranch(gitConfig, existingBranchInfo.workBranch, { cwd });

    return {
      success: true,
      operation: "push",
      durationMs: Date.now() - startTime,
      conflictInfo,
    };
  }

  private async _executePrOperation(): Promise<GitTaskResult> {
    const { prConfig, ghConfig, prContext, cwd, promptsDir, dryRun } = this._options;

    if (!prConfig || !ghConfig || !prContext || !cwd || !promptsDir) {
      throw new Error("PR operation requires prConfig, ghConfig, prContext, cwd, and promptsDir");
    }

    const startTime = Date.now();

    // Create draft PR
    const prResult = await createDraftPR(prConfig, ghConfig, prContext, {
      cwd,
      promptsDir,
      dryRun
    });

    if (!prResult) {
      return {
        success: false,
        operation: "pr",
        durationMs: Date.now() - startTime,
        error: "Failed to create PR",
      };
    }

    // Enable auto-merge if configured
    if (prConfig.autoMerge && prResult.number > 0) {
      const autoMergeSuccess = await enableAutoMerge(
        prResult.number,
        prContext.repo,
        prConfig.mergeMethod,
        {
          ghPath: ghConfig.path,
          dryRun,
          isDraft: prConfig.draft,
          deleteBranch: prConfig.deleteBranch,
        }
      );

      if (!autoMergeSuccess) {
        logger.warn(`Failed to enable auto-merge for PR #${prResult.number}`);
      }
    }

    return {
      success: true,
      operation: "pr",
      durationMs: Date.now() - startTime,
      prResult,
    };
  }

  private async _executeFullWorkflow(): Promise<GitTaskResult> {
    const startTime = Date.now();
    const results: Partial<GitTaskResult>[] = [];

    try {
      // 1. Branch creation
      if (this._options.issueNumber && this._options.issueTitle) {
        const branchResult = await this._executeBranchOperation();
        results.push(branchResult);
        if (!branchResult.success) {
          throw new Error(`Branch creation failed: ${branchResult.error}`);
        }
      }

      // 2. Commit
      if (this._options.commitMessage) {
        const commitResult = await this._executeCommitOperation();
        results.push(commitResult);
        if (!commitResult.success) {
          throw new Error(`Commit failed: ${commitResult.error}`);
        }
      }

      // 3. Push
      if (this._options.existingBranchInfo) {
        const pushResult = await this._executePushOperation();
        results.push(pushResult);
        if (!pushResult.success) {
          throw new Error(`Push failed: ${pushResult.error}`);
        }
      }

      // 4. PR creation
      if (this._options.prConfig && this._options.prContext) {
        const prResult = await this._executePrOperation();
        results.push(prResult);
        if (!prResult.success) {
          throw new Error(`PR creation failed: ${prResult.error}`);
        }
      }

      // Aggregate results
      const aggregatedResult: GitTaskResult = {
        success: true,
        operation: "full-workflow",
        durationMs: Date.now() - startTime,
        branchInfo: results.find(r => r.branchInfo)?.branchInfo,
        commitHash: results.find(r => r.commitHash)?.commitHash,
        prResult: results.find(r => r.prResult)?.prResult,
        conflictInfo: results.find(r => r.conflictInfo)?.conflictInfo,
      };

      return aggregatedResult;
    } catch (error) {
      throw error; // Will trigger rollback in main run() method
    }
  }

  private async _performRollback(): Promise<void> {
    const rollbackDetails: string[] = [];

    try {
      // Rollback branch creation
      if (this._rollbackData.branchCreated && this._options.cwd) {
        try {
          await deleteRemoteBranch(
            this._options.gitConfig,
            this._rollbackData.branchCreated,
            { cwd: this._options.cwd }
          );
          rollbackDetails.push(`Deleted remote branch: ${this._rollbackData.branchCreated}`);
        } catch (error) {
          rollbackDetails.push(`Failed to delete remote branch: ${error}`);
        }
      }

      // Additional rollback logic for worktree cleanup could be added here
      // when worktree management is implemented

      if (this._result) {
        this._result.rollbackPerformed = true;
        this._result.rollbackDetails = rollbackDetails;
      }

      logger.info(`Rollback completed: ${rollbackDetails.join("; ")}`);
    } catch (error) {
      logger.error(`Rollback failed: ${error}`);
      throw error;
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) {
      return;
    }

    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();
    this._emitter.emit("killed");

    // Perform rollback on kill if enabled
    if (this._options.enableRollback) {
      try {
        await this._performRollback();
      } catch (rollbackError) {
        logger.warn(`Rollback on kill failed: ${rollbackError}`);
      }
    }
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
        operation: this._options.operation,
        issueNumber: this._options.issueNumber,
        issueTitle: this._options.issueTitle,
        enableRollback: this._options.enableRollback,
        success: this._result?.success,
        branchName: this._result?.branchInfo?.workBranch,
        commitHash: this._result?.commitHash,
        prNumber: this._result?.prResult?.number,
        prUrl: this._result?.prResult?.url,
        rollbackPerformed: this._result?.rollbackPerformed,
      },
    };
  }

  getResult(): GitTaskResult | undefined {
    return this._result;
  }

  /**
   * SerializedTask로부터 GitTask를 복원
   * 복원된 태스크는 PENDING 상태로 시작
   */
  static fromJSON(data: SerializedTask, gitConfig: GitConfig): GitTask {
    const metadata = data.metadata ?? {};
    const operation = metadata.operation as GitOperationType || "branch";
    const issueNumber = typeof metadata.issueNumber === "number" ? metadata.issueNumber : undefined;
    const issueTitle = typeof metadata.issueTitle === "string" ? metadata.issueTitle : undefined;
    const enableRollback = typeof metadata.enableRollback === "boolean" ? metadata.enableRollback : false;

    return new GitTask({
      id: data.id,
      operation,
      gitConfig,
      issueNumber,
      issueTitle,
      enableRollback,
    });
  }

  /**
   * 롤백 기능을 수동으로 실행
   */
  async rollback(): Promise<void> {
    if (this._status === TaskStatus.RUNNING) {
      throw new Error("Cannot rollback while task is running");
    }

    await this._performRollback();
  }
}