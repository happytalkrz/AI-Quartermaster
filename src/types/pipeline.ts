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

export interface ValidationPhaseContext {
  commands: {
    claudeCli: any;
  };
  cwd: string;
  gitPath: string;
  maxRetries: number;
  plan: Plan;
  phaseResults: PhaseResult[];
  jl?: any;
}

export interface PublishPhaseContext {
  issueNumber: number;
  repo: string;
  issue: {
    title: string;
  };
  plan: Plan;
  phaseResults: PhaseResult[];
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  gitConfig: any;
  projectConfig: {
    safety: any;
    pr: any;
    commands: {
      ghCli: any;
    };
  };
  promptsDir: string;
  dryRun: boolean;
  jl?: any;
}

export interface CleanupContext {
  worktreePath?: string;
  branchName?: string;
  gitConfig: any;
  projectRoot: string;
  cleanupOnSuccess: boolean;
  cleanupOnFailure: boolean;
  issueNumber: number;
  repo: string;
  plan: Plan;
  phaseResults: PhaseResult[];
  startTime: number;
  prUrl?: string;
  config: any;
  aqRoot?: string;
  dataDir: string;
}

export interface FailureHandlerContext {
  error: unknown;
  state: PipelineState;
  worktreePath?: string;
  branchName?: string;
  rollbackHash?: string;
  rollbackStrategy: string;
  gitConfig: any;
  projectRoot: string;
  cleanupOnFailure: boolean;
  jl?: any;
}

export interface PipelineSetupContext {
  issueNumber: number;
  repo: string;
  config: import("./config.js").AQConfig;
  projectConfig: import("./config.js").ProjectConfig;
  projectRoot: string;
  promptsDir: string;
  dataDir: string;
  issue: import("../github/issue-fetcher.js").GitHubIssue;
  mode: import("./config.js").PipelineMode;
  gitConfig: import("./config.js").GitConfig;
  branchName?: string;
  worktreePath?: string;
  existingPrUrl?: string;
  maxTotalDurationMs: number;
  isRetry?: boolean;
  resumeFromState?: PipelineState;
}

export interface PipelineSetupResult {
  success: boolean;
  context?: PipelineSetupContext;
  state: PipelineState;
  error?: string;
  existingPrUrl?: string;
}

// Plan 재시도 관련 타입 정의

export interface ContextualizationInfo {
  /** 관련 파일의 함수 시그니처 정보 */
  functionSignatures: {
    [filePath: string]: string[];
  };
  /** Import 관계 정보 */
  importRelations: {
    [filePath: string]: {
      imports: string[];
      exports: string[];
    };
  };
  /** 타입 정의 정보 */
  typeDefinitions: {
    [filePath: string]: string[];
  };
}

export interface PlanGenerationResult {
  success: boolean;
  plan?: Plan;
  error?: string;
  errorCategory?: ErrorCategory;
  attempt: number;
  durationMs: number;
  timestamp: string;
}

export interface PlanRetryContext {
  /** 현재 재시도 횟수 (0부터 시작) */
  currentAttempt: number;
  /** 최대 재시도 횟수 */
  maxRetries: number;
  /** Plan 생성 시도 히스토리 */
  generationHistory: PlanGenerationResult[];
  /** 구체화된 컨텍스트 정보 */
  contextualization?: ContextualizationInfo;
  /** 마지막 실패 시점 */
  lastFailureAt?: string;
  /** 재시도 가능 여부 */
  canRetry: boolean;
}
