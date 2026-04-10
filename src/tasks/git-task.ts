import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AQMTask, TaskStatus, AQMTaskSummary, BaseTaskOptions, TaskLifecycleEvent, TaskEventListener, SerializedTask } from "./aqm-task.js";
import { createWorktree, removeWorktree } from "../git/worktree-manager.js";
import { createWorkBranch, deleteRemoteBranch } from "../git/branch-manager.js";
import { createSlugWithFallback } from "../utils/slug.js";
import type { GitConfig, WorktreeConfig } from "../types/config.js";

export interface GitOperation {
  type: "create-worktree" | "remove-worktree" | "create-branch" | "delete-branch" | "cleanup";
  branchName?: string;
  worktreePath?: string;
  baseBranch?: string;
  issueNumber?: number;
  issueTitle?: string; // Required for createWorkBranch
}

/**
 * Git 태스크 실행을 위한 옵션
 * BaseTaskOptions를 확장하여 Git 특화 옵션 추가
 */
export interface GitTaskOptions extends BaseTaskOptions {
  /** Git 설정 */
  config: GitConfig;
  /** Worktree 설정 */
  worktreeConfig?: WorktreeConfig;
  /** 실행할 Git 작업 */
  operation: GitOperation;
  /** 프로젝트 루트 경로 */
  projectRoot?: string;
  /** 강제 실행 여부 */
  force?: boolean;
}

export interface GitTaskResult {
  success: boolean;
  operation: GitOperation;
  output?: string;
  error?: string;
  durationMs: number;
  branchName?: string;
  worktreePath?: string;
}

/**
 * Git 작업을 처리하는 AQMTask 구현체
 * worktree 생성/삭제, branch 관리 등 Git 관련 작업을 캡슐화
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
      const result = await this._executeGitOperation();
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

      const durationMs = this._completedAt.getTime() - (this._startedAt?.getTime() ?? 0);
      this._result = {
        success: false,
        operation: this._options.operation,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      };

      throw error;
    }
  }

  private async _executeGitOperation(): Promise<GitTaskResult> {
    const startTime = this._startedAt?.getTime() ?? Date.now();
    const { operation, config, worktreeConfig, projectRoot = process.cwd(), force } = this._options;

    try {
      switch (operation.type) {
        case "create-worktree":
          if (!operation.branchName || !operation.issueNumber || !operation.issueTitle || !worktreeConfig) {
            throw new Error("create-worktree requires branchName, issueNumber, issueTitle and worktreeConfig");
          }
          const slug = createSlugWithFallback(operation.issueTitle);
          const worktreeInfo = await createWorktree(
            config,
            worktreeConfig,
            operation.branchName,
            operation.issueNumber,
            slug,
            { cwd: projectRoot }
          );
          return {
            success: true,
            operation,
            output: `Worktree created at ${worktreeInfo.path}`,
            durationMs: Date.now() - startTime,
            branchName: operation.branchName,
            worktreePath: worktreeInfo.path,
          };

        case "remove-worktree":
          if (!operation.worktreePath) {
            throw new Error("remove-worktree requires worktreePath");
          }
          await removeWorktree(config, operation.worktreePath, { cwd: projectRoot, force });
          return {
            success: true,
            operation,
            output: `Worktree removed: ${operation.worktreePath}`,
            durationMs: Date.now() - startTime,
            worktreePath: operation.worktreePath,
          };

        case "create-branch":
          if (!operation.issueNumber || !operation.issueTitle) {
            throw new Error("create-branch requires issueNumber and issueTitle");
          }
          const branchInfo = await createWorkBranch(
            config,
            operation.issueNumber,
            operation.issueTitle,
            { cwd: projectRoot }
          );
          return {
            success: true,
            operation,
            output: `Branch created: ${branchInfo.workBranch}`,
            durationMs: Date.now() - startTime,
            branchName: branchInfo.workBranch,
          };

        case "delete-branch":
          if (!operation.branchName) {
            throw new Error("delete-branch requires branchName");
          }
          await deleteRemoteBranch(config, operation.branchName, { cwd: projectRoot });
          return {
            success: true,
            operation,
            output: `Remote branch deleted: ${operation.branchName}`,
            durationMs: Date.now() - startTime,
            branchName: operation.branchName,
          };

        case "cleanup":
          // 정리 작업: worktree 제거 + branch 삭제
          let output = "";
          if (operation.worktreePath) {
            try {
              await removeWorktree(config, operation.worktreePath, { cwd: projectRoot, force: true });
              output += `Worktree removed: ${operation.worktreePath}`;
            } catch (err) {
              output += `Worktree removal failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
          if (operation.branchName) {
            try {
              await deleteRemoteBranch(config, operation.branchName, { cwd: projectRoot });
              output += output ? "; " : "";
              output += `Remote branch deleted: ${operation.branchName}`;
            } catch (err) {
              output += output ? "; " : "";
              output += `Branch deletion failed: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
          return {
            success: true,
            operation,
            output: output || "Cleanup completed",
            durationMs: Date.now() - startTime,
            branchName: operation.branchName,
            worktreePath: operation.worktreePath,
          };

        default:
          throw new Error(`Unknown git operation: ${(operation as any).type}`);
      }
    } catch (error) {
      return {
        success: false,
        operation,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        branchName: operation.branchName,
        worktreePath: operation.worktreePath,
      };
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) {
      return;
    }

    // Git 작업은 대부분 즉시 완료되므로 강제 종료는 상태만 변경
    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();
    this._emitter.emit("killed");
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
        projectRoot: this._options.projectRoot,
        force: this._options.force,
        success: this._result?.success,
        branchName: this._result?.branchName,
        worktreePath: this._result?.worktreePath,
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
  static fromJSON(data: SerializedTask, config: GitConfig): GitTask {
    const metadata = data.metadata ?? {};
    const operation = metadata.operation as GitOperation;
    const projectRoot = typeof metadata.projectRoot === "string" ? metadata.projectRoot : undefined;
    const force = typeof metadata.force === "boolean" ? metadata.force : undefined;

    if (!operation) {
      throw new Error("GitTask.fromJSON: operation is required in metadata");
    }

    return new GitTask({
      id: data.id,
      operation,
      config,
      projectRoot,
      force,
    });
  }
}