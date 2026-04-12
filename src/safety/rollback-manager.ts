import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import { RollbackError } from "../types/errors.js";
import type { GitConfig, WorktreeConfig } from "../types/config.js";
import type { WorktreeInfo } from "../git/worktree-manager.js";

const logger = getLogger();

export interface WorktreeManager {
  createWorktree: (
    gitConfig: GitConfig,
    worktreeConfig: WorktreeConfig,
    branchName: string,
    issueNumber: number,
    slug: string,
    options: { cwd: string },
    repoSlug?: string
  ) => Promise<WorktreeInfo>;
  removeWorktree: (
    gitConfig: GitConfig,
    worktreePath: string,
    options: { cwd: string; force?: boolean }
  ) => Promise<void>;
}

/**
 * Creates a checkpoint by returning the current HEAD commit hash.
 */
export async function createCheckpoint(
  options: { cwd: string; gitPath?: string }
): Promise<string> {
  const result = await runCli(
    options.gitPath ?? "git",
    ["rev-parse", "HEAD"],
    { cwd: options.cwd }
  );

  if (result.exitCode !== 0) {
    throw new RollbackError("unknown", `Failed to get current HEAD: ${result.stderr}`);
  }

  const hash = result.stdout.trim();
  logger.info(`Checkpoint created: ${hash.slice(0, 8)}`);
  return hash;
}

/**
 * Rolls back to a previous checkpoint (commit hash).
 */
export async function rollbackToCheckpoint(
  hash: string,
  options: { cwd: string; gitPath?: string }
): Promise<void> {
  logger.warn(`Rolling back to checkpoint ${hash.slice(0, 8)}...`);

  const result = await runCli(
    options.gitPath ?? "git",
    ["reset", "--hard", hash],
    { cwd: options.cwd }
  );

  if (result.exitCode !== 0) {
    throw new RollbackError(hash, result.stderr);
  }

  // Clean untracked files
  await runCli(
    options.gitPath ?? "git",
    ["clean", "-fd"],
    { cwd: options.cwd }
  );

  logger.info(`Rolled back to ${hash.slice(0, 8)}`);
}

export interface EnsureCleanStateOptions {
  cwd: string;
  gitPath?: string;
  gitConfig: GitConfig;
  worktreeConfig: WorktreeConfig;
  branchName: string;
  issueNumber: number;
  slug: string;
  worktreePath: string;
  repoSlug?: string;
}

/**
 * Ensures a clean state by rolling back to checkpoint.
 * If rollback fails, removes and recreates the worktree as a fallback.
 */
export async function ensureCleanState(
  hash: string,
  worktreeManager: WorktreeManager,
  options: EnsureCleanStateOptions
): Promise<WorktreeInfo> {
  try {
    logger.info(`Attempting rollback to ${hash.slice(0, 8)} for clean state...`);
    await rollbackToCheckpoint(hash, {
      cwd: options.cwd,
      gitPath: options.gitPath
    });

    logger.info(`Clean state restored via rollback to ${hash.slice(0, 8)}`);
    return {
      path: options.worktreePath,
      branch: options.branchName
    };
  } catch (rollbackError: unknown) {
    logger.warn(`Rollback failed: ${getErrorMessage(rollbackError)}`);
    logger.warn("Falling back to worktree recreation for clean state...");

    try {
      // Remove existing worktree
      await worktreeManager.removeWorktree(
        options.gitConfig,
        options.worktreePath,
        { cwd: options.cwd, force: true }
      );

      // Recreate worktree
      const newWorktreeInfo = await worktreeManager.createWorktree(
        options.gitConfig,
        options.worktreeConfig,
        options.branchName,
        options.issueNumber,
        options.slug,
        { cwd: options.cwd },
        options.repoSlug
      );

      logger.info(`Clean state restored via worktree recreation at ${newWorktreeInfo.path}`);
      return newWorktreeInfo;
    } catch (worktreeError: unknown) {
      const errorMsg = `Failed to ensure clean state. Rollback failed: ${getErrorMessage(rollbackError)}. Worktree recreation failed: ${getErrorMessage(worktreeError)}`;
      throw new RollbackError(hash, errorMsg);
    }
  }
}
