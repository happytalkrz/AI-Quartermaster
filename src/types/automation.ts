export type CronExpression = string; // e.g. "0 9 * * *", "@daily", "@weekly"

export type ScheduledTaskStatus = "idle" | "running" | "failed" | "disabled";

export interface CronSchedule {
  expression: CronExpression;
  timezone?: string; // e.g. "Asia/Seoul", defaults to system timezone
}

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: CronSchedule;
  status: ScheduledTaskStatus;
  lastRunAt?: number; // epoch ms
  nextRunAt?: number; // epoch ms
  lastError?: string;
  runCount: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronSchedule;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export type AutomationConditionType =
  | "issue_label"
  | "issue_age_days"
  | "issue_has_no_activity_days";

export type AutomationActionType =
  | "add_label"
  | "remove_label"
  | "comment"
  | "close_issue"
  | "queue_issue";

export interface AutomationCondition {
  type: AutomationConditionType;
  value: string | number;
}

export interface AutomationAction {
  type: AutomationActionType;
  value?: string;
}

export interface AutomationSchedulerState {
  tasks: ScheduledTask[];
  running: boolean;
}
