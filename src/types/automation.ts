import type { GitHubIssue } from "../github/issue-fetcher.js";

// ─── Trigger Types ───────────────────────────────────────────────────────────

export interface IssueLabeledTrigger {
  type: "issue-labeled";
  /** 특정 라벨에만 반응 (생략 시 모든 라벨에 반응) */
  label?: string;
}

export interface IssueCreatedTrigger {
  type: "issue-created";
}

export interface PipelineFailedTrigger {
  type: "pipeline-failed";
  /** 특정 repo에만 반응 (생략 시 모든 repo) */
  repo?: string;
}

export type Trigger =
  | IssueLabeledTrigger
  | IssueCreatedTrigger
  | PipelineFailedTrigger;

export type TriggerType = Trigger["type"];

// ─── Condition Types ──────────────────────────────────────────────────────────

export interface LabelMatchCondition {
  type: "label-match";
  labels: string[];
  /** 기본값: "or" */
  operator?: "and" | "or";
}

export interface PathMatchCondition {
  type: "path-match";
  /** minimatch glob 패턴 목록 (하나라도 매칭되면 통과) */
  patterns: string[];
}

export interface KeywordMatchCondition {
  type: "keyword-match";
  keywords: string[];
  /** 검사할 필드 (기본값: ["title", "body"]) */
  fields?: Array<"title" | "body">;
  /** 기본값: "or" */
  operator?: "and" | "or";
}

export type Condition =
  | LabelMatchCondition
  | PathMatchCondition
  | KeywordMatchCondition;

// ─── Action Types ─────────────────────────────────────────────────────────────

export interface AddLabelAction {
  type: "add-label";
  labels: string[];
}

export interface StartJobAction {
  type: "start-job";
  /** 기본값: context.repo */
  repo?: string;
}

export interface PauseProjectAction {
  type: "pause-project";
  reason?: string;
}

export type Action =
  | AddLabelAction
  | StartJobAction
  | PauseProjectAction;

export type ActionType = Action["type"];

// ─── AutomationRule ───────────────────────────────────────────────────────────

export interface AutomationRule {
  id: string;
  name: string;
  /** 기본값: true */
  enabled?: boolean;
  trigger: Trigger;
  /** 모든 조건이 AND로 평가됨 */
  conditions?: Condition[];
  actions: Action[];
}

// ─── Rule Engine Context ──────────────────────────────────────────────────────

export interface RuleContext {
  triggerType: TriggerType;
  issue: GitHubIssue;
  repo: string;
  /** issue-labeled 트리거 시 추가된 라벨 */
  triggerLabel?: string;
  /** pipeline 영향을 받은 파일 경로 목록 (path-match 조건에 사용) */
  affectedPaths?: string[];
}

// ─── Rule Engine Handlers ─────────────────────────────────────────────────────

export interface RuleEngineHandlers {
  addLabel: (repo: string, issueNumber: number, labels: string[]) => Promise<void>;
  startJob: (repo: string, issueNumber: number) => Promise<void>;
  pauseProject: (repo: string, reason?: string) => Promise<void>;
}
