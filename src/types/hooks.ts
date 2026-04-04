/**
 * Hook timing definitions for pipeline execution stages
 */
export type HookTiming =
  | "pre-plan"
  | "post-plan"
  | "pre-phase"
  | "post-phase"
  | "pre-review"
  | "post-review"
  | "pre-pr"
  | "post-pr";

/**
 * Hook definition with command and optional timeout
 */
export interface HookDefinition {
  /** Command to execute */
  command: string;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
}

/**
 * Configuration for hooks at different pipeline stages
 */
export type HooksConfig = Partial<Record<HookTiming, HookDefinition[]>>;

/**
 * Context information passed to hooks during execution
 */
export interface HookContext {
  /** Current pipeline stage */
  timing: HookTiming;
  /** Issue number being processed */
  issueNumber: number;
  /** Repository name (owner/repo) */
  repo: string;
  /** Working directory path */
  workingDir: string;
  /** Branch name for the current work */
  branchName?: string;
  /** Phase index (for pre-phase/post-phase hooks) */
  phaseIndex?: number;
  /** Phase name (for pre-phase/post-phase hooks) */
  phaseName?: string;
  /** Environment variables to pass to the hook command */
  env?: Record<string, string>;
}