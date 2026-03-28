export type LogLevel = "debug" | "info" | "warn" | "error";
export type Locale = "ko" | "en";
export type ReviewFailAction = "block" | "warn" | "retry";
export type MergeMethod = "merge" | "squash" | "rebase";

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
  timeout: number;
  additionalArgs: string[];
}

export interface GhCliConfig {
  path: string;
  timeout: number;
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
}

export interface ReviewRound {
  name: string;
  promptTemplate: string;
  failAction: ReviewFailAction;
  maxRetries: number;
  model: string | null;
}

export interface SimplifyConfig {
  enabled: boolean;
  promptTemplate: string;
}

export interface ReviewConfig {
  enabled: boolean;
  rounds: ReviewRound[];
  simplify: SimplifyConfig;
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
}

export interface TimeoutsConfig {
  planGeneration: number;
  phaseImplementation: number;
  reviewRound: number;
  prCreation: number;
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
}

export type PipelineMode = "code" | "content";

/** Per-project configuration. Overrides global defaults for a specific repo. */
export interface ProjectConfig {
  repo: string;           // "owner/repo"
  path: string;           // absolute path to local clone
  baseBranch?: string;    // override git.defaultBaseBranch
  branchTemplate?: string; // override git.branchTemplate
  mode?: PipelineMode;    // default pipeline mode for this project
  commands?: Partial<CommandsConfig>;  // override commands (test, lint, build, etc.)
  review?: Partial<ReviewConfig>;      // override review settings
  pr?: Partial<PrConfig>;             // override PR settings
  safety?: Partial<SafetyConfig>;     // override safety settings
}

export interface AQConfig {
  general: GeneralConfig;
  git: GitConfig;
  worktree: WorktreeConfig;
  commands: CommandsConfig;
  review: ReviewConfig;
  pr: PrConfig;
  safety: SafetyConfig;
  projects?: ProjectConfig[];  // per-project overrides
}
