import { HooksConfig } from "./hooks.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Locale = "ko" | "en";
export type ReviewFailAction = "block" | "warn" | "retry";
export type MergeMethod = "merge" | "squash" | "rebase";
export type WorkerRole = "implementation" | "review";

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

export interface SkillContent {
  name: string;
  category: string;
  description: string;
  content: string;
}

export interface GeneralConfig {
  projectName: string;
  logLevel: LogLevel;
  logDir: string;
  dryRun: boolean;
  locale: Locale;
  concurrency: number;
  targetRoot?: string;
  stuckTimeoutMs: number;
  pollingIntervalMs: number;
  maxJobs: number;
  autoUpdate: boolean;
  instanceLabel?: string;
}

export interface GitConfig {
  defaultBaseBranch: string;
  branchTemplate: string;
  commitMessageTemplate: string;
  remoteAlias: string;
  allowedRepos: string[];
  gitPath: string;
  fetchDepth: number;
  signCommits: boolean;
}

export interface WorktreeConfig {
  rootPath: string;
  cleanupOnSuccess: boolean;
  cleanupOnFailure: boolean;
  maxAge: string;
  dirTemplate: string;
}

export interface ModelRouting {
  plan: string;       // Plan 생성 (복잡한 분석) — 기본 opus
  phase: string;      // Phase 구현 (코딩) — 기본 sonnet
  review: string;     // 리뷰/검증 (확인) — 기본 haiku
  fallback: string;   // 실패 시 폴백 — 기본 sonnet
}

export interface ClaudeCliConfig {
  path: string;
  model: string;            // 글로벌 기본 모델 (routing 미설정 시 사용)
  models: ModelRouting;     // 태스크별 모델 라우팅
  maxTurns: number;
  maxTurnsPerMode?: Record<ExecutionMode, number>; // 실행 모드별 maxTurns 제한
  timeout: number;
  additionalArgs: string[];
  retry?: RetryConfig;
}

export interface GhCliConfig {
  path: string;
  timeout: number;
  retry?: RetryConfig;
}

export interface CommandsConfig {
  claudeCli: ClaudeCliConfig;
  ghCli: GhCliConfig;
  test: string;
  lint: string;
  build: string;
  typecheck: string;
  preInstall: string;
  claudeMdPath: string;
  skillsPath: string;
}

export interface ReviewRound {
  name: string;
  promptTemplate: string;
  failAction: ReviewFailAction;
  maxRetries: number;
  model: string | null;
  blind?: boolean;        // 구현 맥락 차단 (자기평가 편향 방지)
  adversarial?: boolean;  // 적대적 리뷰 모드 (엄격한 평가)
}

export interface SimplifyConfig {
  enabled: boolean;
  promptTemplate: string;
}

export interface ReviewConfig {
  enabled: boolean;
  rounds: ReviewRound[];
  simplify: SimplifyConfig;
  /** 통합 리뷰 모드 활성화 - true시 1회 호출로 3가지 관점 통합 평가 */
  unifiedMode?: boolean;
}

export interface PrConfig {
  targetBranch: string;
  draft: boolean;
  titleTemplate: string;
  bodyTemplate: string;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  linkIssue: boolean;
  autoMerge: boolean;
  mergeMethod: MergeMethod;
  deleteBranch?: boolean;
}

export interface TimeoutsConfig {
  planGeneration: number;
  phaseImplementation: number;
  reviewRound: number;
  prCreation: number;
}

export interface FeasibilityCheckConfig {
  enabled: boolean;
  maxRequirements: number;
  maxFiles: number;
  blockedKeywords: string[];
  skipReasons: string[];
}

export interface SafetyRules {
  allow: string[];
  deny: string[];
}

export interface SafetyConfig {
  sensitivePaths: string[];
  maxPhases: number;
  maxRetries: number;
  maxTotalDurationMs: number;
  maxFileChanges: number;
  maxInsertions: number;
  maxDeletions: number;
  requireTests: boolean;
  blockDirectBasePush: boolean;
  timeouts: TimeoutsConfig;
  stopConditions: string[];
  allowedLabels: string[];
  rollbackStrategy: "none" | "all" | "failed-only";
  feasibilityCheck: FeasibilityCheckConfig;
  strict: boolean;
  rules: SafetyRules;
}

export interface FeaturesConfig {
  /** 병렬 Phase 실행 활성화 여부 (안정성을 위해 기본값은 false) */
  parallelPhases: boolean;
  /** Claude 다중 AI 워커 풀 활성화 여부 */
  multiAI: boolean;
}

export interface ExecutionModePreset {
  reviewRounds: number;
  enableAdvancedReview: boolean;
  enableSimplify: boolean;
  enableFinalValidation: boolean;
  maxPhases: number;
  maxRetries: number;
  description: string;
}

export type PipelineMode = "code" | "content";
export type ExecutionMode = "economy" | "standard" | "thorough";
export type ServerMode = "polling" | "webhook";

/** Setup wizard options */
export interface SetupOptions {
  nonInteractive?: boolean;
}

/** Wizard answers collected during interactive setup */
export interface WizardAnswers {
  repo: string;
  path: string;
  serverMode: ServerMode;
}

/** Options for the init command */
export interface InitCommandOptions {
  /** Override auto-detected repository (default: from git remote) */
  repo?: string;
  /** Override auto-detected path (default: current directory) */
  path?: string;
  /** Override base branch (default: from git config or "main") */
  baseBranch?: string;
  /** Pipeline mode for this project */
  mode?: PipelineMode;
  /** Force overwrite if project already exists in config */
  force?: boolean;
  /** Dry run - show what would be added without writing */
  dryRun?: boolean;
}

/** Per-project configuration. Overrides global defaults for a specific repo. */
/** 프로젝트별 에러 상태 추적 */
export interface ProjectErrorState {
  /** 연속 실패 횟수 */
  consecutiveFailures: number;
  /** 일시 정지 만료 시간 (ms timestamp, null이면 정지되지 않음) */
  pausedUntil: number | null;
  /** 마지막 실패 시간 (ms timestamp) */
  lastFailureAt: number | null;
}

export interface ProjectConfig {
  repo: string;           // "owner/repo"
  path: string;           // absolute path to local clone
  baseBranch?: string;    // override git.defaultBaseBranch
  branchTemplate?: string; // override git.branchTemplate
  mode?: PipelineMode;    // default pipeline mode for this project
  concurrency?: number;   // override general.concurrency for this project
  commands?: Partial<CommandsConfig>;  // override commands (test, lint, build, etc.)
  review?: Partial<ReviewConfig>;      // override review settings
  pr?: Partial<PrConfig>;             // override PR settings
  safety?: Partial<SafetyConfig>;     // override safety settings
  /** 연속 실패 임계값 (기본값: 3) */
  pauseThreshold?: number;
  /** 일시 정지 지속 시간 ms (기본값: 30분) */
  pauseDurationMs?: number;
}

export type AutomationTriggerType = "cron" | "event" | "rate-limit";
export type AutomationEventType = "pr-merged" | "phase-failed";
export type AutomationCronSchedule = "daily" | "weekly";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** cron 트리거 스케줄 (type이 "cron"일 때) */
  schedule?: AutomationCronSchedule;
  /** event 트리거 이벤트명 (type이 "event"일 때) */
  event?: AutomationEventType;
  /** rate-limit 트리거 임계값 (type이 "rate-limit"일 때) */
  threshold?: number;
}

export interface AutomationCondition {
  /** 조건 표현식 (예: "failureCount > 3", "label == 'urgent'") */
  expression: string;
}

export type AutomationActionType = "notify" | "pause" | "retry" | "label" | "close";

export interface AutomationAction {
  type: AutomationActionType;
  /** 액션에 전달할 추가 파라미터 */
  params?: Record<string, string | number | boolean>;
}

export interface AutomationRule {
  /** 규칙 식별자 */
  id: string;
  /** 규칙 설명 */
  description?: string;
  /** 트리거 조건 */
  trigger: AutomationTrigger;
  /** 선택적 조건 (모두 충족해야 액션 실행) */
  conditions?: AutomationCondition[];
  /** 실행할 액션 목록 */
  actions: AutomationAction[];
  /** 규칙 활성화 여부 (기본값: true) */
  enabled?: boolean;
}

export interface AQConfig {
  general: GeneralConfig;
  git: GitConfig;
  worktree: WorktreeConfig;
  commands: CommandsConfig;
  review: ReviewConfig;
  pr: PrConfig;
  safety: SafetyConfig;
  features: FeaturesConfig;
  executionMode: ExecutionMode;
  hooks?: HooksConfig;        // pipeline hooks configuration
  projects?: ProjectConfig[];  // per-project overrides
  automations?: AutomationRule[];  // automation rules
}
