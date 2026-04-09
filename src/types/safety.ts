import type { SafetyConfig, GitConfig } from "./config.js";
import type { Plan } from "./pipeline.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";

/**
 * 규칙이 실행되는 검증 시점
 */
export type RuleCheckpoint = "issue" | "plan" | "push";

/**
 * 규칙 검사 결과
 */
export type RuleResult =
  | { passed: true }
  | { passed: false; message: string; details?: Record<string, unknown> };

/**
 * 이슈 검증 시점 컨텍스트 (파이프라인 시작 전)
 */
export interface IssueRuleContext {
  checkpoint: "issue";
  issue: GitHubIssue;
  safetyConfig: SafetyConfig;
}

/**
 * Plan 검증 시점 컨텍스트 (Plan 생성 후)
 */
export interface PlanRuleContext {
  checkpoint: "plan";
  plan: Plan;
  safetyConfig: SafetyConfig;
}

/**
 * Push 직전 검증 시점 컨텍스트 (diff 수준)
 */
export interface PushRuleContext {
  checkpoint: "push";
  safetyConfig: SafetyConfig;
  gitConfig: GitConfig;
  cwd: string;
  baseBranch: string;
}

/**
 * 모든 검증 시점 컨텍스트의 판별 유니온
 */
export type RuleContext = IssueRuleContext | PlanRuleContext | PushRuleContext;

/**
 * 규칙 인터페이스 — 규칙 엔진에 등록되는 단위 규칙
 */
export interface Rule<C extends RuleContext = RuleContext> {
  /** 규칙 고유 식별자 (예: "label-filter", "phase-limit") */
  readonly id: string;
  /** 이 규칙이 실행되는 검증 시점 */
  readonly checkpoint: C["checkpoint"];
  /** 규칙 검사 실행 — 동기/비동기 모두 지원 */
  check(ctx: C): RuleResult | Promise<RuleResult>;
}

/** 이슈 검증 규칙 */
export type IssueRule = Rule<IssueRuleContext>;

/** Plan 검증 규칙 */
export type PlanRule = Rule<PlanRuleContext>;

/** Push 직전 검증 규칙 */
export type PushRule = Rule<PushRuleContext>;
