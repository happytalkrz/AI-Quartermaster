import { minimatch } from "minimatch";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type {
  AutomationRule,
  Trigger,
  Condition,
  Action,
  RuleContext,
  RuleEngineHandlers,
} from "../types/automation.js";

/**
 * 규칙의 트리거 + 조건이 컨텍스트와 일치하는지 평가한다.
 * enabled=false인 규칙은 false를 반환한다.
 * 조건이 없으면 트리거만 일치하면 통과.
 * 조건이 여러 개면 모두 AND로 평가.
 */
export function evaluateRule(rule: AutomationRule, context: RuleContext): boolean {
  if (rule.enabled === false) return false;

  if (!matchesTrigger(rule.trigger, context)) return false;

  if (rule.conditions && rule.conditions.length > 0) {
    return rule.conditions.every((cond) => matchesCondition(cond, context));
  }

  return true;
}

/**
 * 단일 액션을 실행한다.
 * handlers에 실제 외부 연동 구현을 주입한다.
 */
export async function executeAction(
  action: Action,
  context: RuleContext,
  handlers: RuleEngineHandlers
): Promise<void> {
  const logger = getLogger();

  try {
    switch (action.type) {
      case "add-label": {
        logger.info(
          `[AutomationRuleEngine] add-label: ${context.repo}#${context.issue.number} ← [${action.labels.join(", ")}]`
        );
        await handlers.addLabel(context.repo, context.issue.number, action.labels);
        break;
      }
      case "start-job": {
        const repo = action.repo ?? context.repo;
        logger.info(
          `[AutomationRuleEngine] start-job: ${repo}#${context.issue.number}`
        );
        await handlers.startJob(repo, context.issue.number);
        break;
      }
      case "pause-project": {
        logger.info(
          `[AutomationRuleEngine] pause-project: ${context.repo}${action.reason ? ` (${action.reason})` : ""}`
        );
        await handlers.pauseProject(context.repo, action.reason);
        break;
      }
    }
  } catch (err: unknown) {
    logger.error(
      `[AutomationRuleEngine] executeAction(${action.type}) failed: ${getErrorMessage(err)}`
    );
    throw err;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function matchesTrigger(trigger: Trigger, context: RuleContext): boolean {
  switch (trigger.type) {
    case "issue-labeled": {
      if (context.triggerType !== "issue-labeled") return false;
      if (trigger.label !== undefined && context.triggerLabel !== trigger.label) return false;
      return true;
    }
    case "issue-created": {
      return context.triggerType === "issue-created";
    }
    case "pipeline-failed": {
      if (context.triggerType !== "pipeline-failed") return false;
      if (trigger.repo !== undefined && context.repo !== trigger.repo) return false;
      return true;
    }
  }
}

function matchesCondition(condition: Condition, context: RuleContext): boolean {
  switch (condition.type) {
    case "label-match": {
      const issueLabels = context.issue.labels;
      const operator = condition.operator ?? "or";
      return operator === "and"
        ? condition.labels.every((l) => issueLabels.includes(l))
        : condition.labels.some((l) => issueLabels.includes(l));
    }
    case "path-match": {
      const paths = context.affectedPaths ?? [];
      const opts = { dot: true };
      return condition.patterns.some((pattern) =>
        paths.some((p) => minimatch(p, pattern, opts))
      );
    }
    case "keyword-match": {
      const fields = condition.fields ?? ["title", "body"];
      const text = fields
        .map((f) => (f === "title" ? context.issue.title : context.issue.body))
        .join(" ")
        .toLowerCase();
      const operator = condition.operator ?? "or";
      return operator === "and"
        ? condition.keywords.every((kw) => text.includes(kw.toLowerCase()))
        : condition.keywords.some((kw) => text.includes(kw.toLowerCase()));
    }
  }
}
