import { resolve } from "path";
import { existsSync } from "fs";
import { runCli } from "../utils/cli-runner.js";
import { renderTemplate } from "../prompt/template-renderer.js";
import { getLogger } from "../utils/logger.js";
import type { WorktreeConfig, GitConfig } from "../types/config.js";

const logger = getLogger();

export interface WorktreeInfo {
  path: string;
  branch: string;
}

/**
 * Creates an isolated git worktree for the given branch.
 * The worktree path is derived from worktreeConfig.rootPath + dirTemplate.
 */
export async function createWorktree(
  gitConfig: GitConfig,
  worktreeConfig: WorktreeConfig,
  branchName: string,
  issueNumber: number,
  slug: string,
  options: { cwd: string }
): Promise<WorktreeInfo> {
  const dirName = renderTemplate(worktreeConfig.dirTemplate, {
    issueNumber: String(issueNumber),
    slug,
  });

  // Resolve rootPath relative to cwd if not absolute
  const rootPath = resolve(options.cwd, worktreeConfig.rootPath);
  const worktreePath = resolve(rootPath, dirName);

  // Clean up existing worktree at same path if it exists
  if (existsSync(worktreePath)) {
    logger.warn(`Worktree path already exists, cleaning up: ${worktreePath}`);
    await runCli(gitConfig.gitPath, ["worktree", "remove", worktreePath, "--force"], { cwd: options.cwd });
    await runCli(gitConfig.gitPath, ["worktree", "prune"], { cwd: options.cwd });
  }

  // Create worktree
  const result = await runCli(
    gitConfig.gitPath,
    ["worktree", "add", worktreePath, branchName],
    { cwd: options.cwd }
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create worktree at ${worktreePath}: ${result.stderr}`);
  }

  logger.info(`Created worktree at ${worktreePath} on branch ${branchName}`);

  return {
    path: worktreePath,
    branch: branchName,
  };
}

/**
 * Removes a worktree and prunes.
 */
export async function removeWorktree(
  gitConfig: GitConfig,
  worktreePath: string,
  options: { cwd: string; force?: boolean }
): Promise<void> {
  const args = ["worktree", "remove", worktreePath];
  if (options.force) {
    args.push("--force");
  }

  const result = await runCli(gitConfig.gitPath, args, { cwd: options.cwd });
  if (result.exitCode !== 0) {
    // Try force remove if normal remove fails
    if (!options.force) {
      logger.warn(`Normal worktree remove failed, trying force: ${result.stderr}`);
      const forceResult = await runCli(
        gitConfig.gitPath,
        ["worktree", "remove", worktreePath, "--force"],
        { cwd: options.cwd }
      );
      if (forceResult.exitCode !== 0) {
        throw new Error(`Failed to remove worktree ${worktreePath}: ${forceResult.stderr}`);
      }
    } else {
      throw new Error(`Failed to remove worktree ${worktreePath}: ${result.stderr}`);
    }
  }

  // Prune stale worktree entries
  await runCli(gitConfig.gitPath, ["worktree", "prune"], { cwd: options.cwd });

  logger.info(`Removed worktree at ${worktreePath}`);
}

/**
 * Lists all worktrees for the repository.
 */
export async function listWorktrees(
  gitConfig: GitConfig,
  options: { cwd: string }
): Promise<WorktreeInfo[]> {
  const result = await runCli(
    gitConfig.gitPath,
    ["worktree", "list", "--porcelain"],
    { cwd: options.cwd }
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to list worktrees: ${result.stderr}`);
  }

  const worktrees: WorktreeInfo[] = [];
  const entries = result.stdout.split("\n\n").filter(Boolean);

  for (const entry of entries) {
    const lines = entry.split("\n");
    let path = "";
    let branch = "";

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace("refs/heads/", "");
      }
    }

    if (path) {
      worktrees.push({ path, branch });
    }
  }

  return worktrees;
}

/**
 * Checks if a worktree has uncommitted changes (is dirty).
 */
export async function isWorktreeDirty(
  gitConfig: GitConfig,
  worktreePath: string
): Promise<boolean> {
  const result = await runCli(
    gitConfig.gitPath,
    ["status", "--porcelain"],
    { cwd: worktreePath }
  );
  return result.stdout.trim().length > 0;
}
