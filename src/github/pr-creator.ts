import { resolve } from "path";
import { runCli } from "../utils/cli-runner.js";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { getLogger } from "../utils/logger.js";
import type { PrConfig, GhCliConfig, MergeMethod } from "../types/config.js";
import type { Plan, PhaseResult } from "../types/pipeline.js";

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
}

/**
 * Creates a draft PR on GitHub using gh CLI.
 */
export async function createDraftPR(
  prConfig: PrConfig,
  ghConfig: GhCliConfig,
  ctx: PrContext,
  options: { cwd: string; promptsDir: string; dryRun?: boolean }
): Promise<PrCreateResult> {
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
    });
  } catch {
    // Fallback body if template fails
    body = `## Summary\n\nResolves #${ctx.issueNumber}\n\n${ctx.plan.problemDefinition}\n\n## Phases\n\n${ctx.phaseResults.map(r => `- ${r.phaseName}: ${r.success ? "PASS" : "FAIL"}`).join("\n")}`;
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
    throw new Error(`Failed to create PR: ${result.stderr}`);
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
  options: { ghPath?: string; dryRun?: boolean; isDraft?: boolean }
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
  const mergeResult = await runCli(
    ghPath,
    ["pr", "merge", String(prNumber), "--repo", repo, "--auto", `--${mergeMethod}`],
    {}
  );
  if (mergeResult.exitCode !== 0) {
    logger.warn(`Failed to enable auto-merge on PR #${prNumber}: ${mergeResult.stderr}`);
    return false;
  }

  logger.info(`Auto-merge enabled on PR #${prNumber} (method: ${mergeMethod})`);
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
