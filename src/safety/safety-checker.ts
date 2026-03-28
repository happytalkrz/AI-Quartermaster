import { checkSensitivePaths } from "./sensitive-path-guard.js";
import { checkChangeLimits } from "./change-limit-guard.js";
import { assertNotOnBaseBranch } from "./base-branch-guard.js";
import { checkPhaseLimit } from "./phase-limit-guard.js";
import { isAllowedLabel } from "./label-filter.js";
import { collectDiff } from "../git/diff-collector.js";
import { getLogger } from "../utils/logger.js";
import type { SafetyConfig, GitConfig } from "../types/config.js";
import type { Plan } from "../types/pipeline.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { SafetyViolationError } from "../types/errors.js";

const logger = getLogger();

export interface SafetyContext {
  safetyConfig: SafetyConfig;
  gitConfig: GitConfig;
  cwd: string;
  baseBranch: string;
}

/**
 * Pre-pipeline validation: check labels and repo allowance.
 */
export function validateIssue(
  issue: GitHubIssue,
  safetyConfig: SafetyConfig
): void {
  if (!isAllowedLabel(issue.labels, safetyConfig.allowedLabels)) {
    throw new SafetyViolationError(
      "LabelFilter",
      `Issue labels [${issue.labels.join(", ")}] do not match allowed labels [${safetyConfig.allowedLabels.join(", ")}]`
    );
  }
}

/**
 * Post-plan validation: check phase count.
 */
export function validatePlan(
  plan: Plan,
  safetyConfig: SafetyConfig
): void {
  checkPhaseLimit(plan.phases.length, safetyConfig.maxPhases);
}

/**
 * Pre-push validation: check branch, sensitive paths, and change limits.
 */
export async function validateBeforePush(ctx: SafetyContext): Promise<void> {
  // Ensure not on base branch
  await assertNotOnBaseBranch(ctx.baseBranch, {
    cwd: ctx.cwd,
    gitPath: ctx.gitConfig.gitPath,
  });

  // Collect diff stats
  const diffStats = await collectDiff(ctx.gitConfig, ctx.baseBranch, { cwd: ctx.cwd });

  // Check sensitive paths
  checkSensitivePaths(diffStats.changedFiles, ctx.safetyConfig.sensitivePaths);

  // Check change limits
  checkChangeLimits(
    {
      filesChanged: diffStats.filesChanged,
      insertions: diffStats.insertions,
      deletions: diffStats.deletions,
    },
    {
      maxFileChanges: ctx.safetyConfig.maxFileChanges,
      maxInsertions: ctx.safetyConfig.maxInsertions,
      maxDeletions: ctx.safetyConfig.maxDeletions,
    }
  );

  logger.info("Safety checks passed");
}

