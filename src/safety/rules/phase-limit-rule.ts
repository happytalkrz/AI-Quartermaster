import type { PlanRule, PlanRuleContext, RuleResult } from "../../types/safety.js";
import { checkPhaseLimit } from "../phase-limit-guard.js";
import { SafetyViolationError } from "../../types/errors.js";

export const phaseLimitRule: PlanRule = {
  id: "phase-limit",
  checkpoint: "plan",
  check(ctx: PlanRuleContext): RuleResult {
    try {
      checkPhaseLimit(ctx.plan.phases.length, ctx.safetyConfig.maxPhases);
      return { passed: true };
    } catch (err: unknown) {
      if (err instanceof SafetyViolationError) {
        return { passed: false, message: err.message, details: err.details };
      }
      throw err;
    }
  },
};
