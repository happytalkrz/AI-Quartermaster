import type { PushRule, PushRuleContext, RuleResult } from "../../types/safety.js";
import { checkChangeLimits } from "../change-limit-guard.js";
import { collectDiff } from "../../git/diff-collector.js";
import { SafetyViolationError } from "../../types/errors.js";

export const changeLimitRule: PushRule = {
  id: "change-limit",
  checkpoint: "push",
  async check(ctx: PushRuleContext): Promise<RuleResult> {
    try {
      const diffStats = await collectDiff(ctx.gitConfig, ctx.baseBranch, { cwd: ctx.cwd });
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
      return { passed: true };
    } catch (err: unknown) {
      if (err instanceof SafetyViolationError) {
        return { passed: false, message: err.message, details: err.details };
      }
      throw err;
    }
  },
};
