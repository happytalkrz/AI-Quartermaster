import { SafetyViolationError } from "../types/errors.js";
import { getLogger } from "../utils/logger.js";
import type {
  Rule,
  RuleContext,
  RuleCheckpoint,
  RuleResult,
  IssueRuleContext,
  PlanRuleContext,
  PushRuleContext,
} from "../types/safety.js";

interface StoredRule {
  id: string;
  checkpoint: RuleCheckpoint;
  warnOnly: boolean;
  // Runtime safety is guaranteed: we only call this after filtering by checkpoint
  check: (ctx: RuleContext) => RuleResult | Promise<RuleResult>;
}

/**
 * 규칙 엔진 — guard 로직을 플러그인 방식으로 등록하고 시점별로 실행한다.
 *
 * - blocking 규칙: 실패 시 SafetyViolationError를 throw한다.
 * - warn-only 규칙: 실패 시 경고 로그만 남기고 계속 진행한다.
 */
export class RuleEngine {
  private readonly rules: StoredRule[] = [];
  private readonly logger = getLogger();

  /**
   * 규칙을 엔진에 등록한다.
   *
   * @param rule      등록할 규칙 객체
   * @param options   { warnOnly: true } 이면 실패 시 경고만 남기고 진행
   */
  register<C extends RuleContext>(
    rule: Rule<C>,
    options?: { warnOnly?: boolean }
  ): this {
    this.rules.push({
      id: rule.id,
      checkpoint: rule.checkpoint,
      warnOnly: options?.warnOnly ?? false,
      // Checkpoint matching before invocation guarantees runtime type safety
      check: rule.check.bind(rule) as StoredRule["check"],
    });
    return this;
  }

  async run(checkpoint: "issue", ctx: IssueRuleContext): Promise<void>;
  async run(checkpoint: "plan", ctx: PlanRuleContext): Promise<void>;
  async run(checkpoint: "push", ctx: PushRuleContext): Promise<void>;
  async run(checkpoint: RuleCheckpoint, ctx: RuleContext): Promise<void> {
    const relevant = this.rules.filter((r) => r.checkpoint === checkpoint);

    for (const { id, warnOnly, check } of relevant) {
      const result = await check(ctx);

      if (!result.passed) {
        if (warnOnly) {
          this.logger.warn(
            `[${id}] ${result.message} — 경고만 남기고 계속 진행합니다`
          );
        } else {
          throw new SafetyViolationError(id, result.message, result.details);
        }
      }
    }
  }
}
