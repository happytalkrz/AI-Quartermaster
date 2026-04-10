import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { AQMTask, TaskStatus, type AQMTaskSummary, type BaseTaskOptions, type TaskLifecycleEvent, type TaskEventListener } from "./aqm-task.js";
import {
  syncBaseBranch,
  createWorkBranch,
  pushBranch,
  deleteRemoteBranch,
  checkConflicts,
  type BranchInfo
} from "../git/branch-manager.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { createDraftPR, type PrCreateResult, type PrContext } from "../github/pr-creator.js";
import type { GitConfig, PrConfig, GhCliConfig } from "../types/config.js";
import type { Plan, PhaseResult, UsageInfo } from "../types/pipeline.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export type GitTaskStep =
  | "sync-base"
  | "create-branch"
  | "commit-changes"
  | "push-branch"
  | "create-pr";

export interface GitTaskResult {
  success: boolean;
  step: GitTaskStep;
  branchInfo?: BranchInfo;
  commitHash?: string;
  prResult?: PrCreateResult;
  error?: string;
  durationMs: number;
}

export interface GitTaskOptions extends BaseTaskOptions {
  /** Issue number for branch naming and PR creation */
  issueNumber: number;
  /** Issue title for branch naming */
  issueTitle: string;
  /** Repository name (owner/repo) */
  repo: string;
  /** Git configuration */
  gitConfig: GitConfig;
  /** PR configuration */
  prConfig: PrConfig;
  /** GitHub CLI configuration */
  ghConfig: GhCliConfig;
  /** Plan object for PR context */
  plan: Plan;
  /** Phase results for PR context */
  phaseResults: PhaseResult[];
  /** Prompts directory for PR template */
  promptsDir: string;
  /** Dry run mode */
  dryRun?: boolean;
  /** Total cost for PR context */
  totalCostUsd?: number;
  /** Total usage for PR context */
  totalUsage?: UsageInfo;
  /** Commit message for changes */
  commitMessage?: string;
  /** Steps to execute (default: all steps) */
  steps?: GitTaskStep[];
}

/**
 * Git operations task that wraps branch-manager, commit-helper, and pr-creator modules.
 * Handles the complete git workflow: sync, branch, commit, push, PR creation.
 */
export class GitTask implements AQMTask {
  public readonly id: string;
  public readonly type = "git" as const;

  private _status: TaskStatus = TaskStatus.PENDING;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _results: GitTaskResult[] = [];
  private _currentStep?: GitTaskStep;
  private _branchInfo?: BranchInfo;
  private _commitHash?: string;
  private _prResult?: PrCreateResult;
  private readonly _options: GitTaskOptions;
  private readonly _emitter = new EventEmitter();

  constructor(options: GitTaskOptions) {
    this.id = options.id ?? randomUUID();
    this._options = { ...options, id: this.id };

    // Default to all steps if not specified
    if (!this._options.steps) {
      this._options.steps = ["sync-base", "create-branch", "commit-changes", "push-branch", "create-pr"];
    }
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

  async run(): Promise<GitTaskResult[]> {
    if (this._status !== TaskStatus.PENDING) {
      throw new Error(`Task ${this.id} is already ${this._status} and cannot be run again`);
    }

    this._status = TaskStatus.RUNNING;
    this._startedAt = new Date();
    this._emitter.emit("started");

    try {
      const steps = this._options.steps!;

      for (const step of steps) {
        this._currentStep = step;
        const stepStartTime = Date.now();

        try {
          await this._executeStep(step);
          const durationMs = Date.now() - stepStartTime;

          this._results.push({
            success: true,
            step,
            branchInfo: this._branchInfo,
            commitHash: this._commitHash,
            prResult: this._prResult,
            durationMs,
          });

          logger.info(`Git task step ${step} completed successfully`);
        } catch (error: unknown) {
          const durationMs = Date.now() - stepStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);

          this._results.push({
            success: false,
            step,
            error: errorMessage,
            durationMs,
          });

          logger.error(`Git task step ${step} failed: ${errorMessage}`);

          // Attempt rollback on failure
          await this._rollback(step);

          this._completedAt = new Date();
          this._status = TaskStatus.FAILED;
          this._emitter.emit("failed");

          throw error;
        }
      }

      this._completedAt = new Date();
      this._status = TaskStatus.SUCCESS;
      this._emitter.emit("completed");

      return this._results;
    } catch (error) {
      this._completedAt = new Date();
      this._status = TaskStatus.FAILED;
      this._emitter.emit("failed");
      throw error;
    } finally {
      this._currentStep = undefined;
    }
  }

  private async _executeStep(step: GitTaskStep): Promise<void> {
    const cwd = this._options.cwd ?? process.cwd();

    switch (step) {
      case "sync-base":
        await this._syncBase(cwd);
        break;
      case "create-branch":
        await this._createBranch(cwd);
        break;
      case "commit-changes":
        await this._commitChanges(cwd);
        break;
      case "push-branch":
        await this._pushBranch(cwd);
        break;
      case "create-pr":
        await this._createPr(cwd);
        break;
      default:
        throw new Error(`Unknown git task step: ${step}`);
    }
  }

  private async _syncBase(cwd: string): Promise<void> {
    logger.info("Syncing base branch...");
    await syncBaseBranch(this._options.gitConfig, { cwd });
  }

  private async _createBranch(cwd: string): Promise<void> {
    logger.info("Creating work branch...");
    this._branchInfo = await createWorkBranch(
      this._options.gitConfig,
      this._options.issueNumber,
      this._options.issueTitle,
      { cwd }
    );
  }

  private async _commitChanges(cwd: string): Promise<void> {
    logger.info("Committing changes...");
    const commitMessage = this._options.commitMessage ?? `feat: implement #${this._options.issueNumber}`;

    this._commitHash = await autoCommitIfDirty(
      this._options.gitConfig.gitPath,
      cwd,
      commitMessage
    );

    if (!this._commitHash) {
      logger.info("No changes to commit - working tree is clean");
    }
  }

  private async _pushBranch(cwd: string): Promise<void> {
    if (!this._branchInfo) {
      throw new Error("Branch info not available - create-branch step must run first");
    }

    logger.info(`Pushing branch ${this._branchInfo.workBranch}...`);
    await pushBranch(this._options.gitConfig, this._branchInfo.workBranch, { cwd });
  }

  private async _createPr(cwd: string): Promise<void> {
    if (!this._branchInfo) {
      throw new Error("Branch info not available - create-branch step must run first");
    }

    logger.info("Creating draft PR...");

    const prContext: PrContext = {
      issueNumber: this._options.issueNumber,
      issueTitle: this._options.issueTitle,
      repo: this._options.repo,
      plan: this._options.plan,
      phaseResults: this._options.phaseResults,
      branchName: this._branchInfo.workBranch,
      baseBranch: this._branchInfo.baseBranch,
      totalCostUsd: this._options.totalCostUsd,
      totalUsage: this._options.totalUsage,
    };

    const prResult = await createDraftPR(
      this._options.prConfig,
      this._options.ghConfig,
      prContext,
      {
        cwd,
        promptsDir: this._options.promptsDir,
        dryRun: this._options.dryRun,
      }
    );

    if (!prResult) {
      throw new Error("Failed to create draft PR");
    }

    this._prResult = prResult;
  }

  private async _rollback(failedStep: GitTaskStep): Promise<void> {
    try {
      logger.info(`Attempting rollback after failed step: ${failedStep}`);

      const cwd = this._options.cwd ?? process.cwd();

      // Rollback strategy depends on which step failed
      switch (failedStep) {
        case "sync-base":
          // Nothing to rollback for sync failure
          break;

        case "create-branch":
          // Clean up any partial branch creation
          if (this._branchInfo) {
            try {
              await deleteRemoteBranch(this._options.gitConfig, this._branchInfo.workBranch, { cwd });
            } catch {
              // Best effort - ignore if branch doesn't exist on remote
            }
          }
          break;

        case "commit-changes":
          // Rollback any partial commits (git reset)
          if (this._commitHash) {
            const { runCli } = await import("../utils/cli-runner.js");
            await runCli(this._options.gitConfig.gitPath, ["reset", "--hard", "HEAD~1"], { cwd });
          }
          break;

        case "push-branch":
          // Delete remote branch if it was created
          if (this._branchInfo) {
            try {
              await deleteRemoteBranch(this._options.gitConfig, this._branchInfo.workBranch, { cwd });
            } catch {
              // Best effort - ignore if branch doesn't exist on remote
            }
          }
          break;

        case "create-pr":
          // Can't rollback PR creation - it's idempotent
          break;
      }

      logger.info(`Rollback completed for failed step: ${failedStep}`);
    } catch (rollbackError: unknown) {
      logger.error(`Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      // Don't throw - rollback failure shouldn't mask the original error
    }
  }

  async kill(): Promise<void> {
    if (this._status !== TaskStatus.RUNNING) {
      return;
    }

    logger.info(`Killing git task ${this.id}...`);

    // Best effort rollback of current step
    if (this._currentStep) {
      await this._rollback(this._currentStep);
    }

    this._status = TaskStatus.KILLED;
    this._completedAt = new Date();
    this._emitter.emit("killed");
  }

  toJSON(): AQMTaskSummary {
    const durationMs =
      this._completedAt && this._startedAt
        ? this._completedAt.getTime() - this._startedAt.getTime()
        : undefined;

    const successfulSteps = this._results.filter(r => r.success).length;
    const totalSteps = this._options.steps?.length ?? 0;

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
        repo: this._options.repo,
        steps: this._options.steps,
        currentStep: this._currentStep,
        successfulSteps,
        totalSteps,
        branchName: this._branchInfo?.workBranch,
        baseBranch: this._branchInfo?.baseBranch,
        commitHash: this._commitHash,
        prUrl: this._prResult?.url,
        prNumber: this._prResult?.number,
        dryRun: this._options.dryRun,
      },
    };
  }

  getResults(): GitTaskResult[] {
    return [...this._results];
  }

  getBranchInfo(): BranchInfo | undefined {
    return this._branchInfo;
  }

  getCommitHash(): string | undefined {
    return this._commitHash;
  }

  getPrResult(): PrCreateResult | undefined {
    return this._prResult;
  }
}