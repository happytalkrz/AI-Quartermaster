export type HookTiming =
  | "pre-plan"
  | "post-plan"
  | "pre-phase"
  | "post-phase"
  | "pre-review"
  | "post-review"
  | "pre-pr"
  | "post-pr";

export interface HookDefinition {
  command: string;
  timeout?: number;
}

export type HooksConfig = Partial<Record<HookTiming, HookDefinition[]>>;