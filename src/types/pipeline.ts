export type PipelineState =
  | "RECEIVED"
  | "VALIDATED"
  | "BASE_SYNCED"
  | "BRANCH_CREATED"
  | "WORKTREE_CREATED"
  | "PLAN_GENERATED"
  | "PHASE_IN_PROGRESS"
  | "PHASE_FAILED"
  | "REVIEWING"
  | "SIMPLIFYING"
  | "FINAL_VALIDATING"
  | "DRAFT_PR_CREATED"
  | "DONE"
  | "FAILED";

export interface Plan {
  mode?: "code" | "content";
  issueNumber: number;
  title: string;
  problemDefinition: string;
  requirements: string[];
  affectedFiles: string[];
  risks: string[];
  phases: Phase[];
  verificationPoints: string[];
  stopConditions: string[];
}

export interface Phase {
  index: number;
  name: string;
  description: string;
  targetFiles: string[];
  commitStrategy: string;
  verificationCriteria: string[];
  dependsOn?: number[];
}

export type ErrorCategory =
  | "TS_ERROR"
  | "TIMEOUT"
  | "CLI_CRASH"
  | "VERIFICATION_FAILED"
  | "SAFETY_VIOLATION"
  | "UNKNOWN";

export interface ErrorHistoryEntry {
  attempt: number;
  errorCategory: ErrorCategory;
  errorMessage: string;
  timestamp: string;
}

export interface PhaseResult {
  phaseIndex: number;
  phaseName: string;
  success: boolean;
  commitHash?: string;
  error?: string;
  errorCategory?: ErrorCategory;
  lastOutput?: string;
  durationMs: number;
}

export interface PipelineResult {
  issueNumber: number;
  repo: string;
  state: PipelineState;
  plan?: Plan;
  phaseResults: PhaseResult[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/** Context information for pipeline setup phase - contains resolved config and issue data */
export interface PipelineSetupContext {
  /** Basic pipeline input */
  issueNumber: number;
  repo: string; // "owner/repo"

  /** Resolved project configuration (global config + project overrides) */
  config: import("./config.js").AQConfig;
  projectConfig: import("./config.js").ProjectConfig;

  /** File system paths */
  projectRoot: string;
  promptsDir: string;
  dataDir: string;

  /** Issue information fetched from GitHub */
  issue: import("../github/issue-fetcher.js").GitHubIssue;

  /** Pipeline mode determined from labels/config */
  mode: import("./config.js").PipelineMode;

  /** Git configuration (with project-specific overrides applied) */
  gitConfig: import("./config.js").GitConfig;

  /** Branch and worktree information (if already created) */
  branchName?: string;
  worktreePath?: string;

  /** Duplicate PR check result */
  existingPrUrl?: string;

  /** Pipeline timing constraints */
  maxTotalDurationMs: number;

  /** Resume information for retries */
  isRetry?: boolean;
  resumeFromState?: PipelineState;
}

/** Result of pipeline setup phase */
export interface PipelineSetupResult {
  /** Whether setup completed successfully */
  success: boolean;

  /** The setup context if successful */
  context?: PipelineSetupContext;

  /** Current pipeline state after setup */
  state: PipelineState;

  /** Error information if setup failed */
  error?: string;

  /** If an existing PR was found, return early with this URL */
  existingPrUrl?: string;
}
