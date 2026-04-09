import type { PushRule, PushRuleContext, RuleResult } from "../../types/safety.js";
import { assertNotOnBaseBranch } from "../base-branch-guard.js";
import { SafetyViolationError } from "../../types/errors.js";

export const baseBranchRule: PushRule = {
  id: "base-branch",
  checkpoint: "push",
  async check(ctx: PushRuleContext): Promise<RuleResult> {
    try {
      await assertNotOnBaseBranch(ctx.baseBranch, {
        cwd: ctx.cwd,
        gitPath: ctx.gitConfig.gitPath,
      });
      return { passed: true };
    } catch (err: unknown) {
      if (err instanceof SafetyViolationError) {
        return { passed: false, message: err.message, details: err.details };
      }
      throw err;
    }
  },
};
