import type { IssueRule, IssueRuleContext, RuleResult } from "../../types/safety.js";
import { isAllowedLabel } from "../label-filter.js";

export const labelRule: IssueRule = {
  id: "label-filter",
  checkpoint: "issue",
  check(ctx: IssueRuleContext): RuleResult {
    const passed = isAllowedLabel(ctx.issue.labels, ctx.safetyConfig.allowedLabels);
    if (passed) return { passed: true };
    return {
      passed: false,
      message: `Issue labels [${ctx.issue.labels.join(", ")}] do not match allowed labels [${ctx.safetyConfig.allowedLabels.join(", ")}]`,
    };
  },
};
