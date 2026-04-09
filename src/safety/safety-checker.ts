import { RuleEngine } from "./rule-engine.js";
import {
  labelRule,
  phaseLimitRule,
  baseBranchRule,
  sensitivePathRule,
  changeLimitRule,
} from "./rules/index.js";
import { getLogger } from "../utils/logger.js";
import type { SafetyConfig, GitConfig } from "../types/config.js";
import type { Plan } from "../types/pipeline.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { SafetyViolationError } from "../types/errors.js";
import type { RuleResult } from "../types/safety.js";

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
  const result = labelRule.check({ checkpoint: "issue", issue, safetyConfig }) as RuleResult;
  if (!result.passed) {
    throw new SafetyViolationError("LabelFilter", result.message, result.details);
  }
}

/**
 * Post-plan validation: check phase count.
 */
export function validatePlan(
  plan: Plan,
  safetyConfig: SafetyConfig
): void {
  const result = phaseLimitRule.check({ checkpoint: "plan", plan, safetyConfig }) as RuleResult;
  if (!result.passed) {
    throw new SafetyViolationError(phaseLimitRule.id, result.message, result.details);
  }
}

/**
 * Pre-push validation: check branch, sensitive paths, and change limits.
 */
export async function validateBeforePush(ctx: SafetyContext): Promise<void> {
  const engine = new RuleEngine();
  engine
    .register(baseBranchRule)
    .register(sensitivePathRule)
    .register(changeLimitRule, { warnOnly: true });

  await engine.run("push", {
    checkpoint: "push",
    safetyConfig: ctx.safetyConfig,
    gitConfig: ctx.gitConfig,
    cwd: ctx.cwd,
    baseBranch: ctx.baseBranch,
  });

  logger.info("Safety checks passed");
}
