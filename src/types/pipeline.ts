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
  | "CI_CHECKING"
  | "CI_FIXING"
  | "DONE"
  | "FAILED"
  | "SKIPPED";

export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

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
  costUsd?: number;
  usage?: UsageInfo;
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

export interface PlanWithCost {
  plan: Plan;
  costUsd?: number;
  usage?: UsageInfo;
}

export type ErrorCategory =
  | "TS_ERROR"
  | "TIMEOUT"
  | "CLI_CRASH"
  | "VERIFICATION_FAILED"
  | "SAFETY_VIOLATION"
  | "RATE_LIMIT"
  | "PROMPT_TOO_LONG"
  | "UNKNOWN";

export type MergeStateStatus =
  | "CLEAN"
  | "DIRTY"
  | "UNKNOWN"
  | "BEHIND"
  | "CONFLICTED";

export interface PrConflictInfo {
  prNumber: number;
  repo: string;
  conflictFiles: string[];
  detectedAt: string;
  mergeStatus: MergeStateStatus;
}

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
  costUsd?: number;
  usage?: UsageInfo;
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
  totalCostUsd?: number;
  totalUsage?: UsageInfo;
}

export interface ValidationPhaseContext {
  commands: {
    claudeCli: import("./config.js").ClaudeCliConfig;
  };
  cwd: string;
  gitPath: string;
  maxRetries: number;
  plan: Plan;
  phaseResults: PhaseResult[];
  jl?: import("../queue/job-logger.js").JobLogger;
}

export interface PublishPhaseContext {
  issueNumber: number;
  repo: string;
  issue: import("../github/issue-fetcher.js").GitHubIssue;
  plan: Plan;
  phaseResults: PhaseResult[];
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  gitConfig: import("./config.js").GitConfig;
  projectConfig: {
    safety: import("./config.js").SafetyConfig;
    pr: import("./config.js").PrConfig;
    commands: {
      ghCli: import("./config.js").GhCliConfig;
    };
  };
  promptsDir: string;
  dryRun: boolean;
  jl?: import("../queue/job-logger.js").JobLogger;
  totalUsage?: UsageInfo;
}

export interface CleanupContext {
  worktreePath?: string;
  branchName?: string;
  gitConfig: import("./config.js").GitConfig;
  projectRoot: string;
  cleanupOnSuccess: boolean;
  cleanupOnFailure: boolean;
  issueNumber: number;
  repo: string;
  plan: Plan;
  phaseResults: PhaseResult[];
  startTime: number;
  prUrl?: string;
  config: import("./config.js").AQConfig;
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
  gitConfig: import("./config.js").GitConfig;
  projectRoot: string;
  cleanupOnFailure: boolean;
  jl?: import("../queue/job-logger.js").JobLogger;
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

// 프롬프트 레이어 분리를 위한 타입 정의

/**
 * 기본 레이어 - 역할과 규칙 등 정적 내용
 */
export interface BaseLayer {
  /** AI 역할 정의 (예: "시니어 개발자", "소프트웨어 아키텍트") */
  role: string;
  /** 기본 규칙과 지침 */
  rules: string[];
  /** 출력 포맷 지침 */
  outputFormat: string;
  /** 진행 보고 규칙 */
  progressReporting: string;
  /** 병렬 작업 가이드 */
  parallelWorkGuide: string;
}

/**
 * 프로젝트 레이어 - 프로젝트 수준 설정 (정적)
 */
export interface ProjectLayer {
  /** 프로젝트 컨벤션 (CLAUDE.md 내용) */
  conventions: string;
  /** 프로젝트 구조 정보 */
  structure: string;
  /** 스킬 컨텍스트 */
  skillsContext?: string;
  /** 과거 실패 사례 */
  pastFailures?: string;
  /** 테스트 명령어 */
  testCommand: string;
  /** 린트 명령어 */
  lintCommand: string;
  /** 프로젝트 특정 안전 규칙 */
  safetyRules: string[];
}

/**
 * Phase 레이어 - 현재 실행 컨텍스트 (동적)
 */
export interface PhaseLayer {
  /** 이슈 정보 */
  issue: {
    number: number;
    title: string;
    body: string;
    labels: string[];
  };
  /** 전체 계획 요약 */
  planSummary: string;
  /** 현재 Phase 정보 */
  currentPhase: {
    index: number;
    totalCount: number;
    name: string;
    description: string;
    targetFiles: string[];
  };
  /** 이전 Phase 결과 요약 */
  previousResults: string;
  /** 저장소 정보 */
  repository: {
    owner: string;
    name: string;
    baseBranch: string;
    workBranch: string;
  };
  /** 로케일 설정 */
  locale?: string;
}

/**
 * 조합된 프롬프트 레이어
 */
export interface PromptLayer {
  /** 기본 레이어 (정적) */
  base: BaseLayer;
  /** 프로젝트 레이어 (정적) */
  project: ProjectLayer;
  /** Phase 레이어 (동적) */
  phase: PhaseLayer;
}

/**
 * 캐시된 프롬프트 레이어 (Base + Project는 1회만 조립)
 */
export interface CachedPromptLayer {
  /** 정적 레이어 조합 결과 (Base + Project) */
  staticContent: string;
  /** 정적 레이어 캐시 키 (프로젝트 루트 + 컨벤션 해시) */
  cacheKey: string;
  /** 캐시 생성 시각 */
  createdAt: string;
  /** Phase 레이어 템플릿 (동적 부분만) */
  phaseTemplate: string;
}

/**
 * 프롬프트 조립 결과
 */
export interface AssembledPrompt {
  /** 최종 조립된 프롬프트 */
  content: string;
  /** 사용된 캐시 키 */
  cacheKey?: string;
  /** 캐시 히트 여부 */
  cacheHit: boolean;
  /** 조립에 소요된 시간 (ms) */
  assemblyTimeMs: number;
}
