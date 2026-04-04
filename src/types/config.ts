export type LogLevel = "debug" | "info" | "warn" | "error";
export type Locale = "ko" | "en";
export type ReviewFailAction = "block" | "warn" | "retry";
export type MergeMethod = "merge" | "squash" | "rebase";

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
  rollbackStrategy: "none" | "all" | "failed-only";
}

export interface NotificationConfig {
  webhookUrl?: string;  // Discord/Slack 웹훅 URL (job 실패 시 알림)
}

export type PipelineMode = "code" | "content";
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
  notification?: Partial<NotificationConfig>; // override notification settings
}

export interface AQConfig {
  general: GeneralConfig;
  git: GitConfig;
  worktree: WorktreeConfig;
  commands: CommandsConfig;
  review: ReviewConfig;
  pr: PrConfig;
  safety: SafetyConfig;
  notification: NotificationConfig;
  projects?: ProjectConfig[];  // per-project overrides
}
