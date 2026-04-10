import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { GitConfig, WorktreeConfig } from "../types/config.js";
import {
  type AQMTask,
  TaskStatus,
  type AQMTaskSummary,
  type BaseTaskOptions,
  type TaskLifecycleEvent,
  type TaskEventListener,
} from "./aqm-task.js";
import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
  type BranchInfo,
} from "../git/branch-manager.js";
import {
  createWorktree,
  removeWorktree,
  type WorktreeInfo,
} from "../git/worktree-manager.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";

/**
 * GitTask가 지원하는 git 작업 파라미터 (discriminated union)
 */
export type GitTaskParams =
  | {
      operation: "syncBaseBranch";
      gitConfig: GitConfig;
    }
  | {
      operation: "createWorkBranch";
      gitConfig: GitConfig;
      issueNumber: number;
      issueTitle: string;
    }
  | {
      operation: "createWorktree";
      gitConfig: GitConfig;
      worktreeConfig: WorktreeConfig;
      branchName: string;
      issueNumber: number;
      slug: string;
      repoSlug?: string;
    }
  | {
      operation: "removeWorktree";
      gitConfig: GitConfig;
      worktreePath: string;
      force?: boolean;
    }
  | {
      operation: "pushBranch";
      gitConfig: GitConfig;
      branchName: string;
    }
  | {
      operation: "autoCommit";
      gitPath: string;
      commitMsg: string;
    };

/**
 * GitTask 실행 결과 (discriminated union)
 */
export type GitTaskResult =
  | { operation: "syncBaseBranch" }
  | { operation: "createWorkBranch"; branch: BranchInfo }
  | { operation: "createWorktree"; worktree: WorktreeInfo }
  | { operation: "removeWorktree" }
  | { operation: "pushBranch" }
  | { operation: "autoCommit"; commitHash: string | undefined };

/**
 * GitTask 생성 옵션
 */
export interface GitTaskOptions extends BaseTaskOptions {
  /** 실행할 git 작업 파라미터 */
  params: GitTaskParams;
}

/**
 * Git 작업(worktree, branch, commit)을 AQMTask 인터페이스로 래핑하는 구현체
 */
export class GitTask implements AQMTask {
  public readonly id: string;
  public readonly type = "git" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _result?: GitTaskResult;
  private _killed = false;
  private readonly _options: GitTaskOptions;
  private readonly _emitter = new EventEmitter();

  constructor(options: GitTaskOptions) {
    this.id = options.id ?? randomUUID();
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
      const result = await this._execute();

      // 실행 중 kill()이 호출되었으면 KILLED로 처리
      if (this._killed) {
        this._completedAt = new Date();
        this._status = TaskStatus.KILLED;
        this._emitter.emit("killed");
        throw new Error(`Task ${this.id} was killed`);
      }

      this._completedAt = new Date();
      this._status = TaskStatus.SUCCESS;
      this._result = result;
      this._emitter.emit("completed");
      return result;
    } catch (err: unknown) {
      if (this._status !== TaskStatus.KILLED) {
        this._completedAt = new Date();
        this._status = TaskStatus.FAILED;
        this._emitter.emit("failed");
      }
      throw err;
    }
  }

  private async _execute(): Promise<GitTaskResult> {
    const { params } = this._options;
    const cwd = this._options.cwd ?? process.cwd();

    switch (params.operation) {
      case "syncBaseBranch":
        await syncBaseBranch(params.gitConfig, { cwd });
        return { operation: "syncBaseBranch" };

      case "createWorkBranch": {
        const branch = await createWorkBranch(
          params.gitConfig,
          params.issueNumber,
          params.issueTitle,
          { cwd }
        );
        return { operation: "createWorkBranch", branch };
      }

      case "createWorktree": {
        const worktree = await createWorktree(
          params.gitConfig,
          params.worktreeConfig,
          params.branchName,
          params.issueNumber,
          params.slug,
          { cwd },
          params.repoSlug
        );
        return { operation: "createWorktree", worktree };
      }

      case "removeWorktree":
        await removeWorktree(params.gitConfig, params.worktreePath, {
          cwd,
          force: params.force,
        });
        return { operation: "removeWorktree" };

      case "pushBranch":
        await pushBranch(params.gitConfig, params.branchName, { cwd });
        return { operation: "pushBranch" };

      case "autoCommit": {
        const commitHash = await autoCommitIfDirty(
          params.gitPath,
          cwd,
          params.commitMsg
        );
        return { operation: "autoCommit", commitHash };
      }
    }
  }

  async kill(): Promise<void> {
    if (this._status === TaskStatus.PENDING) {
      this._killed = true;
      this._status = TaskStatus.KILLED;
      this._completedAt = new Date();
      this._emitter.emit("killed");
      return;
    }

    if (this._status === TaskStatus.RUNNING) {
      // git 작업은 중단 불가 — 완료 후 KILLED로 전환되도록 플래그 설정
      this._killed = true;
    }
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
        operation: this._options.params.operation,
      },
    };
  }

  getResult(): GitTaskResult | undefined {
    return this._result;
  }
}
