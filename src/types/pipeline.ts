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
  /** 부분 성공 여부 — 일부 파일만 실패한 경우 true */
  partial?: boolean;
  warnings?: string[];
  errors?: string[];
  commitHash?: string;
  error?: string;
  errorCategory?: ErrorCategory;
  lastOutput?: string;
  durationMs: number;
  startedAt?: string;
  completedAt?: string;
  costUsd?: number;
  usage?: UsageInfo;
  /** 재시도가 필요한 실패 파일 목록 (partial=true일 때 유효) */
  failedFiles?: string[];
  /** 성공적으로 처리된 파일 목록 (partial=true일 때 유효) */
  successfulFiles?: string[];
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

// BaseLayer는 layer-types.ts와 동일 — import 후 re-export로 중복 제거
import type { BaseLayer } from "../prompt/layer-types.js";
export type { BaseLayer };

// IssueLayer, LearningLayer, CacheKeyConfig, PromptLayers는 새 5계층 타입 — 호환성을 위해 re-export
export type {
  IssueLayer,
  LearningLayer,
  CacheKeyConfig,
  PromptLayers,
} from "../prompt/layer-types.js";

/**
 * 프로젝트 레이어 - 프로젝트 수준 설정 (정적)
 * @note layer-types.ts의 ProjectLayer보다 pastFailures? 필드가 추가됨.
 *       template-renderer.ts에서 사용 중이므로 별도 유지.
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

// Job Discriminated Union Types

export type JobStatus = "queued" | "running" | "success" | "failure" | "cancelled" | "archived";

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface PhaseResultInfo {
  name: string;
  success: boolean;
  commit?: string;
  durationMs: number;
  error?: string;
  costUsd?: number;
  usage?: UsageStats;
}

/**
 * Job의 공통 필드들
 */
export interface JobBase {
  id: string;
  issueNumber: number;
  repo: string;
  createdAt: string;
  lastUpdatedAt?: string;
  logs?: string[];
  currentStep?: string;
  dependencies?: number[];
  phaseResults?: PhaseResultInfo[];
  progress?: number;
  isRetry?: boolean;
  costUsd?: number;
  totalCostUsd?: number;
  totalUsage?: UsageStats;
}

/**
 * 큐에 대기 중인 Job - 아직 시작되지 않음
 */
export interface QueuedJob extends JobBase {
  status: "queued";
  // 시작되지 않았으므로 이런 필드들은 없음
  startedAt?: never;
  completedAt?: never;
  prUrl?: never;
  error?: never;
}

/**
 * 실행 중인 Job
 */
export interface RunningJob extends JobBase {
  status: "running";
  startedAt: string; // 실행 중이면 시작 시각 필수
  // 아직 완료되지 않았으므로 완료 관련 필드들은 없음
  completedAt?: never;
  prUrl?: never;
  error?: string; // 실행 중에도 에러 정보가 있을 수 있음 (중간 실패)
}

/**
 * 성공한 Job
 */
export interface SuccessJob extends JobBase {
  status: "success";
  startedAt: string;
  completedAt: string;
  prUrl: string; // 성공하면 PR URL 필수
  error?: never; // 성공했으므로 에러 없음
}

/**
 * 실패한 Job
 */
export interface FailureJob extends JobBase {
  status: "failure";
  startedAt: string;
  completedAt: string;
  error: string; // 실패했으므로 에러 메시지 필수
  prUrl?: string; // PR 생성 후 실패한 경우도 있을 수 있음
}

/**
 * 취소된 Job
 */
export interface CancelledJob extends JobBase {
  status: "cancelled";
  completedAt: string;
  // 시작 전 취소될 수도 있고, 실행 중 취소될 수도 있음
  startedAt?: string;
  // 취소 사유가 있을 수 있음
  error?: string;
  prUrl?: never; // 취소되었으므로 PR 없음
}

/**
 * 아카이브된 Job
 */
export interface ArchivedJob extends JobBase {
  status: "archived";
  // 아카이브는 다른 상태에서 전환되므로 모든 필드 허용
  startedAt?: string;
  completedAt?: string;
  prUrl?: string;
  error?: string;
}

/**
 * 모든 Job 상태의 Union 타입
 */
export type Job = QueuedJob | RunningJob | SuccessJob | FailureJob | CancelledJob | ArchivedJob;

// Job 타입 가드 함수들

/**
 * QueuedJob 타입 가드
 */
export function isQueuedJob(job: Job): job is QueuedJob {
  return job.status === "queued";
}

/**
 * RunningJob 타입 가드
 */
export function isRunningJob(job: Job): job is RunningJob {
  return job.status === "running";
}

/**
 * SuccessJob 타입 가드
 */
export function isSuccessJob(job: Job): job is SuccessJob {
  return job.status === "success";
}

/**
 * FailureJob 타입 가드
 */
export function isFailureJob(job: Job): job is FailureJob {
  return job.status === "failure";
}

/**
 * CancelledJob 타입 가드
 */
export function isCancelledJob(job: Job): job is CancelledJob {
  return job.status === "cancelled";
}

/**
 * ArchivedJob 타입 가드
 */
export function isArchivedJob(job: Job): job is ArchivedJob {
  return job.status === "archived";
}

/**
 * Job이 완료된 상태인지 확인 (success/failure/cancelled/archived)
 */
export function isCompletedJob(job: Job): job is SuccessJob | FailureJob | CancelledJob | ArchivedJob {
  return job.status === "success" || job.status === "failure" || job.status === "cancelled" || job.status === "archived";
}

/**
 * Job이 활성 상태인지 확인 (queued/running)
 */
export function isActiveJob(job: Job): job is QueuedJob | RunningJob {
  return job.status === "queued" || job.status === "running";
}
