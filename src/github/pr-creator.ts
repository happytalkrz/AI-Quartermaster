import { resolve } from "path";
import { runCli } from "../utils/cli-runner.js";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { PrConfig, GhCliConfig, MergeMethod } from "../types/config.js";
import type { Plan, PhaseResult, PrConflictInfo, MergeStateStatus, UsageInfo } from "../types/pipeline.js";

const logger = getLogger();

export interface PrCreateResult {
  url: string;
  number: number;
}

export interface PrContext {
  issueNumber: number;
  issueTitle: string;
  repo: string;
  plan: Plan;
  phaseResults: PhaseResult[];
  branchName: string;
  baseBranch: string;
  totalCostUsd?: number;
  totalUsage?: UsageInfo;
  instanceLabel?: string;
}

/**
 * Creates a draft PR on GitHub using gh CLI.
 */
export async function createDraftPR(
  prConfig: PrConfig,
  ghConfig: GhCliConfig,
  ctx: PrContext,
  options: { cwd: string; promptsDir: string; dryRun?: boolean }
): Promise<PrCreateResult | null> {
  // Build PR title
  const title = renderTemplate(prConfig.titleTemplate, {
    issueNumber: String(ctx.issueNumber),
    title: ctx.issueTitle,
  });

  // Build PR body from template
  let body: string;
  try {
    const template = loadTemplate(resolve(options.promptsDir, prConfig.bodyTemplate));
    body = renderTemplate(template, {
      issue: {
        number: String(ctx.issueNumber),
        title: ctx.issueTitle,
      },
      plan: {
        summary: ctx.plan.problemDefinition,
        phases: JSON.stringify(ctx.plan.phases.map(p => p.name)),
        requirements: ctx.plan.requirements.join("\n- "),
        risks: ctx.plan.risks.join("\n- "),
      },
      phases: ctx.phaseResults.map(r =>
        `- Phase ${r.phaseIndex}: ${r.phaseName} — ${r.success ? "SUCCESS" : "FAILED"} (${r.commitHash?.slice(0, 8) || "N/A"})`
      ).join("\n"),
      branch: {
        base: ctx.baseBranch,
        work: ctx.branchName,
      },
      instanceLabel: ctx.instanceLabel || 'default',
      stats: {
        totalCostUsd: ctx.totalCostUsd?.toFixed(4) || '0.0000',
        phaseCount: ctx.phaseResults.length,
        successCount: ctx.phaseResults.filter(r => r.success).length,
        inputTokens: ctx.totalUsage?.input_tokens || 0,
        outputTokens: ctx.totalUsage?.output_tokens || 0,
        cacheCreationTokens: ctx.totalUsage?.cache_creation_input_tokens || 0,
        cacheReadTokens: ctx.totalUsage?.cache_read_input_tokens || 0,
      },
    });
  } catch (err: unknown) {
    // Fallback body if template fails
    const phasesText = ctx.phaseResults?.length
      ? ctx.phaseResults.map(r => `- ${r.phaseName}: ${r.success ? "PASS" : "FAIL"}`).join("\n")
      : 'No phases completed';
    const problemDef = ctx.plan?.problemDefinition || 'Issue resolution in progress';
    body = `## Summary\n\nResolves #${ctx.issueNumber}\n\n${problemDef}\n\n## Phases\n\n${phasesText}`;
  }

  // Add issue link
  if (prConfig.linkIssue) {
    body += `\n\nCloses #${ctx.issueNumber}`;
  }

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would create PR: ${title}`);
    return { url: "https://github.com/dry-run", number: 0 };
  }

  // Build gh pr create command
  const args = [
    "pr", "create",
    "--repo", ctx.repo,
    "--head", ctx.branchName,
    "--base", prConfig.targetBranch || ctx.baseBranch,
    "--title", title,
    "--body", body,
  ];

  if (prConfig.draft) {
    args.push("--draft");
  }

  if (ctx.instanceLabel) {
    args.push("--label", ctx.instanceLabel);
  }
  for (const label of prConfig.labels) {
    args.push("--label", label);
  }
  for (const assignee of prConfig.assignees) {
    args.push("--assignee", assignee);
  }
  for (const reviewer of prConfig.reviewers) {
    args.push("--reviewer", reviewer);
  }

  const result = await runCli(ghConfig.path, args, {
    cwd: options.cwd,
    timeout: ghConfig.timeout,
  });

  if (result.exitCode !== 0) {
    logger.error(`Failed to create PR: ${result.stderr}`);
    return null;
  }

  // gh pr create outputs the PR URL
  const url = result.stdout.trim();
  const prNumberMatch = url.match(/\/pull\/(\d+)/);
  const number = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

  logger.info(`Created draft PR: ${url}`);
  return { url, number };
}

/**
 * Enables auto-merge on a PR via gh CLI.
 * If the PR was created as a draft (prConfig.draft === true), it must be un-drafted first
 * before GitHub will accept the auto-merge request. A warning is logged in that case so
 * the operator is aware the draft status is being cleared.
 * Best-effort: returns false (with a warning) instead of throwing on failure.
 */
export async function enableAutoMerge(
  prNumber: number,
  repo: string,
  mergeMethod: MergeMethod,
  options: { ghPath?: string; dryRun?: boolean; isDraft?: boolean; deleteBranch?: boolean }
): Promise<boolean> {
  const ghPath = options.ghPath ?? "gh";

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would enable auto-merge on PR #${prNumber} (method: ${mergeMethod})`);
    return true;
  }

  // Only call `gh pr ready` if the PR was created as a draft — un-drafting is required
  // before GitHub will accept an auto-merge request on a draft PR.
  if (options.isDraft) {
    logger.warn(`PR #${prNumber} was created as a draft but auto-merge is enabled — marking as ready for review.`);
    const readyResult = await runCli(ghPath, ["pr", "ready", String(prNumber), "--repo", repo], {});
    if (readyResult.exitCode !== 0) {
      logger.warn(`Failed to mark PR #${prNumber} as ready: ${readyResult.stderr}`);
      return false;
    }
  }

  // Enable auto-merge
  const mergeArgs = ["pr", "merge", String(prNumber), "--repo", repo, "--auto", `--${mergeMethod}`];
  if (options.deleteBranch) {
    mergeArgs.push("--delete-branch");
  }

  const mergeResult = await runCli(ghPath, mergeArgs, {});
  if (mergeResult.exitCode !== 0) {
    logger.warn(`Failed to enable auto-merge on PR #${prNumber}: ${mergeResult.stderr}`);
    return false;
  }

  logger.info(`Auto-merge enabled on PR #${prNumber} (method: ${mergeMethod})`);
  return true;
}

/**
 * Adds a comment to an issue on GitHub using gh CLI.
 * Best-effort: returns false (with a warning) instead of throwing on failure.
 */
export async function addIssueComment(
  issueNumber: number,
  repo: string,
  comment: string,
  options: { ghPath?: string; dryRun?: boolean }
): Promise<boolean> {
  const ghPath = options.ghPath ?? "gh";

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would add comment to issue #${issueNumber}: ${comment}`);
    return true;
  }

  // Add comment to issue
  const result = await runCli(
    ghPath,
    ["issue", "comment", String(issueNumber), "--repo", repo, "--body", comment],
    {}
  );
  if (result.exitCode !== 0) {
    logger.warn(`Failed to comment on issue #${issueNumber}: ${result.stderr}`);
    return false;
  }

  logger.info(`Added comment to issue #${issueNumber}`);
  return true;
}

/**
 * Closes an issue on GitHub using gh CLI.
 * Best-effort: returns false (with a warning) instead of throwing on failure.
 */
export async function closeIssue(
  issueNumber: number,
  repo: string,
  options: { ghPath?: string; dryRun?: boolean }
): Promise<boolean> {
  const ghPath = options.ghPath ?? "gh";

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would close issue #${issueNumber}`);
    return true;
  }

  // Close issue
  const result = await runCli(
    ghPath,
    ["issue", "close", String(issueNumber), "--repo", repo],
    {}
  );
  if (result.exitCode !== 0) {
    logger.warn(`Failed to close issue #${issueNumber}: ${result.stderr}`);
    return false;
  }

  logger.info(`Closed issue #${issueNumber}`);
  return true;
}

/**
 * Checks PR conflict status and returns detailed conflict information.
 * Uses gh pr view to check merge status and gh pr diff to identify conflict files.
 */
export async function checkPrConflict(
  prNumber: number,
  repo: string,
  options: { ghPath?: string; dryRun?: boolean; timeout?: number }
): Promise<PrConflictInfo | null> {
  const ghPath = options.ghPath ?? "gh";

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would check PR #${prNumber} for conflicts`);
    return null;
  }

  const timeout = options.timeout;

  try {
    // Check PR merge status using gh pr view
    const viewResult = await runCli(
      ghPath,
      ["pr", "view", String(prNumber), "--repo", repo, "--json", "mergeStateStatus,mergeable"],
      timeout !== undefined ? { timeout } : {}
    );

    if (viewResult.exitCode !== 0) {
      logger.warn(`Failed to check PR #${prNumber} status: ${viewResult.stderr}`);
      return null;
    }

    const prInfo = JSON.parse(viewResult.stdout.trim());
    const mergeStateStatus: MergeStateStatus = prInfo.mergeStateStatus || "UNKNOWN";
    const mergeable = prInfo.mergeable;

    // If status is DIRTY or not mergeable, get conflict files
    const conflictFiles: string[] = [];
    if (mergeStateStatus === "DIRTY" || mergeable === false) {
      try {
        // Get diff to identify conflict files
        const diffResult = await runCli(
          ghPath,
          ["pr", "diff", String(prNumber), "--repo", repo],
          timeout !== undefined ? { timeout } : {}
        );

        if (diffResult.exitCode === 0) {
          // Parse diff output to extract conflict files
          const fileSet = new Set<string>();
          const filePattern = /^diff --git a\/(.+) b\/(.+)$/;

          for (const line of diffResult.stdout.split("\n")) {
            const match = line.match(filePattern);
            if (match) fileSet.add(match[1]);
          }

          conflictFiles.push(...Array.from(fileSet));
        }
      } catch (diffError: unknown) {
        logger.warn(`Failed to get diff for PR #${prNumber}: ${diffError}`);
      }
    }

    // Return conflict info if there are issues
    if (mergeStateStatus === "DIRTY" || mergeable === false || conflictFiles.length > 0) {
      return {
        prNumber,
        repo,
        conflictFiles,
        detectedAt: new Date().toISOString(),
        mergeStatus: mergeStateStatus,
      };
    }

    return null; // No conflicts detected
  } catch (error: unknown) {
    logger.warn(`Error checking PR #${prNumber} conflicts: ${error}`);
    return null;
  }
}

/**
 * Posts a comment on a GitHub issue using gh CLI.
 * Best-effort: returns false (with a warning) instead of throwing on failure.
 */
export async function commentOnIssue(
  issueNumber: number,
  repo: string,
  comment: string,
  options: { ghPath?: string; dryRun?: boolean }
): Promise<boolean> {
  const ghPath = options.ghPath ?? "gh";

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would comment on issue #${issueNumber}: ${comment.slice(0, 100)}...`);
    return true;
  }

  try {
    const result = await runCli(
      ghPath,
      ["issue", "comment", String(issueNumber), "--repo", repo, "--body", comment],
      {}
    );

    if (result.exitCode !== 0) {
      logger.warn(`Failed to comment on issue #${issueNumber}: ${result.stderr}`);
      return false;
    }

    logger.info(`Added comment to issue #${issueNumber}`);
    return true;
  } catch (error: unknown) {
    logger.warn(`Error commenting on issue #${issueNumber}: ${error}`);
    return false;
  }
}

/**
 * Lists open PRs for a repository using gh CLI.
 */
export async function listOpenPrs(
  repo: string,
  options: { ghPath?: string; dryRun?: boolean; timeout?: number }
): Promise<Array<{ number: number; title: string }> | null> {
  const ghPath = options.ghPath ?? "gh";

  if (options.dryRun) {
    logger.info(`[DRY RUN] Would list open PRs for ${repo}`);
    return [];
  }

  const timeout = options.timeout;

  try {
    const result = await runCli(
      ghPath,
      ["pr", "list", "--repo", repo, "--state", "open", "--json", "number,title", "--limit", "100"],
      timeout !== undefined ? { timeout } : {}
    );

    if (result.exitCode !== 0) {
      logger.warn(`Failed to list PRs for ${repo}: ${result.stderr}`);
      return null;
    }

    const prs = JSON.parse(result.stdout.trim()) as Array<{ number: number; title: string }>;
    logger.debug(`Found ${prs.length} open PRs in ${repo}`);
    return prs;
  } catch (error: unknown) {
    logger.warn(`Error listing PRs for ${repo}: ${error}`);
    return null;
  }
}
