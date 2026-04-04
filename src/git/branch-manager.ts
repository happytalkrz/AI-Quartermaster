import { runCli } from "../utils/cli-runner.js";
import { createSlugWithFallback } from "../utils/slug.js";
import { renderTemplate } from "../prompt/template-renderer.js";
import type { GitConfig } from "../types/config.js";
import { getLogger } from "../utils/logger.js";
import { sanitizeGitError } from "../utils/error-sanitizer.js";

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
    throw new Error(sanitizeGitError(result.stderr, "fetch"));
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
    await deleteRemoteBranch(gitConfig, workBranch, options);
  }

  // Create branch from remote base
  const baseRef = `${gitConfig.remoteAlias}/${gitConfig.defaultBaseBranch}`;
  const createResult = await runCli(
    gitConfig.gitPath,
    ["branch", workBranch, baseRef],
    { cwd: options.cwd }
  );
  if (createResult.exitCode !== 0) {
    throw new Error(`Failed to create branch ${workBranch}: ${sanitizeGitError(createResult.stderr, "branch create")}`);
  }

  logger.info(`Created branch ${workBranch} from ${baseRef}`);

  return {
    baseBranch: gitConfig.defaultBaseBranch,
    workBranch,
  };
}

/**
 * Detects merge conflicts between current HEAD and the remote base branch
 * using git merge-tree (no actual merge performed).
 */
export async function checkConflicts(
  gitConfig: GitConfig,
  baseBranch: string,
  options: { cwd: string }
): Promise<{ hasConflicts: boolean; conflictFiles: string[] }> {
  // Get merge base
  const mergeBaseResult = await runCli(
    gitConfig.gitPath,
    ["merge-base", "HEAD", `${gitConfig.remoteAlias}/${baseBranch}`],
    { cwd: options.cwd }
  );
  if (mergeBaseResult.exitCode !== 0) {
    logger.warn(`Could not determine merge base: ${sanitizeGitError(mergeBaseResult.stderr, "merge-base")}`);
    return { hasConflicts: false, conflictFiles: [] };
  }

  const mergeBase = mergeBaseResult.stdout.trim();

  // Use merge-tree to detect conflicts without touching working tree
  const mergeTreeResult = await runCli(
    gitConfig.gitPath,
    ["merge-tree", mergeBase, "HEAD", `${gitConfig.remoteAlias}/${baseBranch}`],
    { cwd: options.cwd }
  );

  const output = mergeTreeResult.stdout;
  if (!output.includes("<<<<<<<")) {
    return { hasConflicts: false, conflictFiles: [] };
  }

  // Parse conflicting file names from merge-tree output.
  // merge-tree format for conflict sections: "changed in both\n  base   <mode> <hash> <path>\n  ..."
  const conflictFiles: string[] = [];
  const changedBothSections = output.split(/^changed in both$/m);
  for (let i = 1; i < changedBothSections.length; i++) {
    const section = changedBothSections[i];
    const pathMatch = section.match(/base\s+\d+ [a-f0-9]+ (.+)/);
    if (pathMatch) {
      conflictFiles.push(pathMatch[1].trim());
    }
  }

  // Fallback: if we couldn't parse specific files, report generic conflict
  return { hasConflicts: true, conflictFiles };
}

/**
 * Attempts to rebase HEAD onto the remote base branch.
 * Aborts and returns failure if rebase encounters conflicts.
 */
export async function attemptRebase(
  gitConfig: GitConfig,
  baseBranch: string,
  options: { cwd: string }
): Promise<{ success: boolean; error?: string }> {
  const rebaseResult = await runCli(
    gitConfig.gitPath,
    ["rebase", `${gitConfig.remoteAlias}/${baseBranch}`],
    { cwd: options.cwd }
  );

  if (rebaseResult.exitCode === 0) {
    logger.info(`Rebase onto ${gitConfig.remoteAlias}/${baseBranch} succeeded`);
    return { success: true };
  }

  // Rebase failed — abort to restore original state
  const abortResult = await runCli(
    gitConfig.gitPath,
    ["rebase", "--abort"],
    { cwd: options.cwd }
  );
  if (abortResult.exitCode !== 0) {
    logger.warn(`git rebase --abort failed: ${sanitizeGitError(abortResult.stderr, "rebase --abort")}`);
  }

  const error = sanitizeGitError(rebaseResult.stderr || rebaseResult.stdout, "rebase");
  logger.warn(`Rebase failed: ${error}`);
  return { success: false, error };
}

/**
 * Deletes a remote branch.
 */
export async function deleteRemoteBranch(
  gitConfig: GitConfig,
  branchName: string,
  options: { cwd: string }
): Promise<void> {
  const result = await runCli(
    gitConfig.gitPath,
    ["push", gitConfig.remoteAlias, "--delete", branchName],
    { cwd: options.cwd }
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete remote branch ${branchName}: ${sanitizeGitError(result.stderr, "push --delete")}`);
  }
  logger.info(`Deleted remote branch ${branchName} from ${gitConfig.remoteAlias}`);
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
    throw new Error(`Failed to push branch ${branchName}: ${sanitizeGitError(result.stderr, "push")}`);
  }
  logger.info(`Pushed branch ${branchName} to ${gitConfig.remoteAlias}`);
}
