import { runCli } from "../utils/cli-runner.js";
import { createSlugWithFallback } from "../utils/slug.js";
import { renderTemplate } from "../prompt/template-renderer.js";
import type { GitConfig } from "../types/config.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export interface BranchInfo {
  baseBranch: string;
  workBranch: string;
}

/**
 * Fetches the latest from remote and ensures base branch is up to date.
 */
export async function syncBaseBranch(
  gitConfig: GitConfig,
  options: { cwd: string }
): Promise<void> {
  // git fetch <remote> <baseBranch>
  const fetchArgs = [
    "fetch",
    gitConfig.remoteAlias,
    gitConfig.defaultBaseBranch,
  ];
  if (gitConfig.fetchDepth > 0) {
    fetchArgs.push("--depth", String(gitConfig.fetchDepth));
  }

  const result = await runCli(gitConfig.gitPath, fetchArgs, { cwd: options.cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git fetch failed: ${result.stderr}`);
  }
  logger.info(`Synced ${gitConfig.defaultBaseBranch} from ${gitConfig.remoteAlias}`);
}

/**
 * Creates a work branch from the base branch.
 * Branch name follows the template in config (e.g., "ax/{issueNumber}-{slug}")
 */
export async function createWorkBranch(
  gitConfig: GitConfig,
  issueNumber: number,
  issueTitle: string,
  options: { cwd: string }
): Promise<BranchInfo> {
  const slug = createSlugWithFallback(issueTitle);
  const workBranch = renderTemplate(gitConfig.branchTemplate, {
    issueNumber: String(issueNumber),
    slug,
    timestamp: String(Date.now()),
  });

  // Clean up existing branch if it exists
  const checkLocal = await runCli(gitConfig.gitPath, ["branch", "--list", workBranch], { cwd: options.cwd });
  if (checkLocal.stdout.trim()) {
    logger.warn(`Branch ${workBranch} already exists locally, force resetting...`);
    // Detach any worktree using this branch first
    const wtList = await runCli(gitConfig.gitPath, ["worktree", "list", "--porcelain"], { cwd: options.cwd });
    for (const block of wtList.stdout.split("\n\n")) {
      if (block.includes(`branch refs/heads/${workBranch}`)) {
        const pathMatch = block.match(/^worktree (.+)/m);
        if (pathMatch) {
          await runCli(gitConfig.gitPath, ["worktree", "remove", pathMatch[1], "--force"], { cwd: options.cwd });
        }
      }
    }
    await runCli(gitConfig.gitPath, ["branch", "-D", workBranch], { cwd: options.cwd });
  }

  const checkRemote = await runCli(gitConfig.gitPath, ["ls-remote", "--heads", gitConfig.remoteAlias, workBranch], { cwd: options.cwd });
  if (checkRemote.stdout.trim()) {
    logger.warn(`Branch ${workBranch} already exists on remote, deleting...`);
    await runCli(gitConfig.gitPath, ["push", gitConfig.remoteAlias, "--delete", workBranch], { cwd: options.cwd });
  }

  // Create branch from remote base
  const baseRef = `${gitConfig.remoteAlias}/${gitConfig.defaultBaseBranch}`;
  const createResult = await runCli(
    gitConfig.gitPath,
    ["branch", workBranch, baseRef],
    { cwd: options.cwd }
  );
  if (createResult.exitCode !== 0) {
    throw new Error(`Failed to create branch ${workBranch}: ${createResult.stderr}`);
  }

  logger.info(`Created branch ${workBranch} from ${baseRef}`);

  return {
    baseBranch: gitConfig.defaultBaseBranch,
    workBranch,
  };
}

/**
 * Pushes the work branch to remote.
 */
export async function pushBranch(
  gitConfig: GitConfig,
  branchName: string,
  options: { cwd: string }
): Promise<void> {
  const result = await runCli(
    gitConfig.gitPath,
    ["push", "-u", gitConfig.remoteAlias, branchName],
    { cwd: options.cwd }
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to push branch ${branchName}: ${result.stderr}`);
  }
  logger.info(`Pushed branch ${branchName} to ${gitConfig.remoteAlias}`);
}
