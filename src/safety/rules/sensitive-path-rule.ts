import type { PushRule, PushRuleContext, RuleResult } from "../../types/safety.js";
import { checkSensitivePaths } from "../sensitive-path-guard.js";
import { collectDiff } from "../../git/diff-collector.js";
import { SafetyViolationError } from "../../types/errors.js";

export const sensitivePathRule: PushRule = {
  id: "sensitive-path",
  checkpoint: "push",
  async check(ctx: PushRuleContext): Promise<RuleResult> {
    try {
      const diffStats = await collectDiff(ctx.gitConfig, ctx.baseBranch, { cwd: ctx.cwd });
      checkSensitivePaths(diffStats.changedFiles, ctx.safetyConfig.sensitivePaths);
      return { passed: true };
    } catch (err: unknown) {
      if (err instanceof SafetyViolationError) {
        return { passed: false, message: err.message, details: err.details };
      }
      throw err;
    }
  },
};
