import { z } from "zod";

// 프로젝트별 commands 스키마 (test, typecheck, preInstall, build, lint만 허용)
const projectCommandsSchema = z.object({
  test: z.string().optional(),
  typecheck: z.string().optional(),
  preInstall: z.string().optional(),
  build: z.string().optional(),
  lint: z.string().optional(),
});

// CreateProject 요청 스키마 (POST /api/projects)
export const CreateProjectRequestSchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().optional(),
  mode: z.enum(["code", "content"]).optional(),
  commands: projectCommandsSchema.optional(),
}).strict();

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

// UpdateConfig 요청 스키마 (PUT /api/config)
// AQConfig의 부분 업데이트를 위한 스키마
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const localeSchema = z.enum(["ko", "en"]);
const reviewFailActionSchema = z.enum(["block", "warn", "retry"]);
const mergeMethodSchema = z.enum(["merge", "squash", "rebase"]);

const generalConfigUpdateSchema = z.object({
  projectName: z.string().min(1),
  instanceLabel: z.string(),
  instanceOwners: z.array(z.string()),
  logLevel: logLevelSchema,
  logDir: z.string(),
  dryRun: z.boolean(),
  locale: localeSchema,
  concurrency: z.number().int().positive(),
  targetRoot: z.string(),
  stuckTimeoutMs: z.number().int().min(60000),
  pollingIntervalMs: z.number().int().min(10000),
  maxJobs: z.number().int().min(1),
  autoUpdate: z.boolean(),
}).partial();

const gitConfigUpdateSchema = z.object({
  defaultBaseBranch: z.string(),
  branchTemplate: z
    .string()
    .refine((val) => val.includes("{{issueNumber}}") || val.includes("{issueNumber}"), {
      message: "branchTemplate must contain {{issueNumber}} or {issueNumber}",
    }),
  commitMessageTemplate: z.string(),
  remoteAlias: z.string(),
  allowedRepos: z.array(z.string()),
  gitPath: z.string(),
  fetchDepth: z.number().int().nonnegative(),
  signCommits: z.boolean(),
}).partial();

const worktreeConfigUpdateSchema = z.object({
  rootPath: z.string(),
  cleanupOnSuccess: z.boolean(),
  cleanupOnFailure: z.boolean(),
  maxAge: z.string(),
  dirTemplate: z.string(),
}).partial();

const modelRoutingUpdateSchema = z.object({
  plan: z.string(),
  phase: z.string(),
  review: z.string(),
  fallback: z.string(),
}).partial();

const claudeCliConfigUpdateSchema = z.object({
  path: z.string(),
  model: z.string(),
  models: modelRoutingUpdateSchema,
  maxTurns: z.number().int().positive(),
  timeout: z.number().positive(),
  additionalArgs: z.array(z.string()),
}).partial();

const ghCliConfigUpdateSchema = z.object({
  path: z.string(),
  timeout: z.number().positive(),
}).partial();

const commandsConfigUpdateSchema = z.object({
  claudeCli: claudeCliConfigUpdateSchema,
  ghCli: ghCliConfigUpdateSchema,
  test: z.string(),
  lint: z.string(),
  build: z.string(),
  typecheck: z.string(),
  preInstall: z.string(),
  claudeMdPath: z.string(),
}).partial();

const reviewRoundUpdateSchema = z.object({
  name: z.string(),
  promptTemplate: z.string(),
  failAction: reviewFailActionSchema,
  maxRetries: z.number().int().nonnegative(),
  model: z.string().nullable(),
  blind: z.boolean().optional(),
  adversarial: z.boolean().optional(),
}).partial();

const simplifyConfigUpdateSchema = z.object({
  enabled: z.boolean(),
  promptTemplate: z.string(),
}).partial();

const reviewConfigUpdateSchema = z.object({
  enabled: z.boolean(),
  rounds: z.array(reviewRoundUpdateSchema),
  simplify: simplifyConfigUpdateSchema,
}).partial();

const prConfigUpdateSchema = z.object({
  targetBranch: z.string(),
  draft: z.boolean(),
  titleTemplate: z.string(),
  bodyTemplate: z.string(),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  reviewers: z.array(z.string()),
  linkIssue: z.boolean(),
  autoMerge: z.boolean(),
  mergeMethod: mergeMethodSchema,
}).partial();

const timeoutsConfigUpdateSchema = z.object({
  planGeneration: z.number().positive(),
  phaseImplementation: z.number().positive(),
  reviewRound: z.number().positive(),
  prCreation: z.number().positive(),
}).partial();

const safetyConfigUpdateSchema = z.object({
  sensitivePaths: z.array(z.string()),
  maxPhases: z.number().int().min(1).max(20),
  maxRetries: z.number().int().min(1).max(10),
  maxTotalDurationMs: z.number().positive(),
  maxFileChanges: z.number().int().positive(),
  maxInsertions: z.number().int().positive(),
  maxDeletions: z.number().int().positive(),
  requireTests: z.boolean(),
  blockDirectBasePush: z.boolean(),
  timeouts: timeoutsConfigUpdateSchema,
  stopConditions: z.array(z.string()),
  allowedLabels: z.array(z.string()),
  rollbackStrategy: z.enum(["none", "all", "failed-only"]),
}).partial();

const projectConfigUpdateSchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string(),
  branchTemplate: z.string(),
  mode: z.enum(["code", "content"]),
  commands: commandsConfigUpdateSchema,
  review: reviewConfigUpdateSchema,
  pr: prConfigUpdateSchema,
  safety: safetyConfigUpdateSchema,
}).partial();

export const UpdateConfigRequestSchema = z.object({
  general: generalConfigUpdateSchema,
  git: gitConfigUpdateSchema,
  worktree: worktreeConfigUpdateSchema,
  commands: commandsConfigUpdateSchema,
  review: reviewConfigUpdateSchema,
  pr: prConfigUpdateSchema,
  safety: safetyConfigUpdateSchema,
  projects: z.array(projectConfigUpdateSchema),
}).partial();

export type UpdateConfigRequest = z.infer<typeof UpdateConfigRequestSchema>;

// GetJobs 쿼리 스키마 (GET /api/jobs)
export const GetJobsQuerySchema = z.object({
  project: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
}).strict();

export type GetJobsQuery = z.infer<typeof GetJobsQuerySchema>;

// GetSkipEvents 쿼리 스키마 (GET /api/skip-events)
export const GetSkipEventsQuerySchema = z.object({
  repo: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
}).strict();

export type GetSkipEventsQuery = z.infer<typeof GetSkipEventsQuerySchema>;

// GetStats 쿼리 스키마 (GET /api/stats)
export const GetStatsQuerySchema = z.object({
  project: z.string().optional(),
  timeRange: z.enum(["24h", "7d", "30d", "all"]).default("7d"),
}).strict();

export type GetStatsQuery = z.infer<typeof GetStatsQuerySchema>;

// StatsResponse 응답 타입 (GET /api/stats)
export const StatsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  queuedCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  avgDurationMs: z.number().nonnegative(),
  successRate: z.number().min(0).max(100),
  project: z.string().nullable(),
  timeRange: z.enum(["24h", "7d", "30d", "all"]),
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

// GetCosts 쿼리 스키마 (GET /api/costs)
export const GetCostsQuerySchema = z.object({
  project: z.string().optional(),
  timeRange: z.enum(["24h", "7d", "30d", "all"]).default("30d"),
  groupBy: z.enum(["project", "day", "week", "month"]).default("project"),
}).strict();

export type GetCostsQuery = z.infer<typeof GetCostsQuerySchema>;

// CostsResponse 응답 타입 (GET /api/costs)
export const CostEntrySchema = z.object({
  label: z.string(),
  totalCostUsd: z.number().nonnegative(),
  jobCount: z.number().int().nonnegative(),
  avgCostUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheCreationTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  cacheHitRatio: z.number().min(0).max(1),
});

export type CostEntry = z.infer<typeof CostEntrySchema>;

export const CostsResponseSchema = z.object({
  project: z.string().nullable(),
  timeRange: z.enum(["24h", "7d", "30d", "all"]),
  groupBy: z.enum(["project", "day", "week", "month"]),
  summary: z.object({
    totalCostUsd: z.number().nonnegative(),
    jobCount: z.number().int().nonnegative(),
    avgCostUsd: z.number().nonnegative(),
    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    totalCacheCreationTokens: z.number().int().nonnegative(),
    totalCacheReadTokens: z.number().int().nonnegative(),
    cacheHitRatio: z.number().min(0).max(1),
  }),
  breakdown: z.array(CostEntrySchema),
});

export type CostsResponse = z.infer<typeof CostsResponseSchema>;

// GetProjectStats 쿼리 스키마 (GET /api/stats/projects)
export const GetProjectStatsQuerySchema = z.object({
  timeRange: z.enum(["24h", "7d", "30d", "all"]).default("7d"),
}).strict();

export type GetProjectStatsQuery = z.infer<typeof GetProjectStatsQuerySchema>;

// ProjectStatsEntry — 프로젝트별 성공률/비용 통계 항목
export const ProjectStatsEntrySchema = z.object({
  project: z.string(),
  total: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100),
  avgDurationMs: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  avgCostUsd: z.number().nonnegative(),
});

export type ProjectStatsEntry = z.infer<typeof ProjectStatsEntrySchema>;

// ProjectStatsResponse 응답 타입 (GET /api/stats/projects)
export const ProjectStatsResponseSchema = z.object({
  timeRange: z.enum(["24h", "7d", "30d", "all"]),
  projects: z.array(ProjectStatsEntrySchema),
});

export type ProjectStatsResponse = z.infer<typeof ProjectStatsResponseSchema>;

// HealthCheck 응답 스키마 (GET /api/health)
export const HealthCheckResponseSchema = z.object({
  project: z.string(),
  status: z.enum(["healthy", "warning", "error"]),
  checks: z.object({
    gitRemoteAccess: z.object({
      status: z.enum(["ok", "error"]),
      message: z.string().optional(),
    }),
    localPath: z.object({
      status: z.enum(["ok", "error"]),
      message: z.string().optional(),
    }),
    diskSpace: z.object({
      status: z.enum(["ok", "warning", "error"]),
      message: z.string().optional(),
      freeBytes: z.number().optional(),
    }),
    dependencies: z.object({
      status: z.enum(["ok", "warning", "error"]),
      message: z.string().optional(),
    }),
  }),
  lastChecked: z.string(), // ISO 8601 timestamp
}).strict();

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// UpdateJobPriority 요청 스키마 (PUT /api/jobs/:id/priority)
export const UpdateJobPriorityRequestSchema = z.object({
  priority: z.enum(["high", "normal", "low"]),
}).strict();

export type UpdateJobPriorityRequest = z.infer<typeof UpdateJobPriorityRequestSchema>;

// UpdateProject 요청 스키마 (PUT /api/projects/:repo)
export const UpdateProjectRequestSchema = z.object({
  path: z.string().min(1).optional(),
  baseBranch: z.string().nullable().optional(),
  mode: z.enum(["code", "content"]).nullable().optional(),
  commands: projectCommandsSchema.optional(),
}).strict();

export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

// CostBreakdownResponse — GET /api/jobs/:id 응답의 costBreakdown 필드 검증용
export const UsageInfoSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
});

export const ModelCostEntrySchema = z.object({
  model: z.string(),
  costUsd: z.number().nonnegative(),
  usage: UsageInfoSchema,
});

export const PhaseCostEntrySchema = z.object({
  phaseIndex: z.number().int().nonnegative(),
  phaseName: z.string(),
  costUsd: z.number().nonnegative(),
  retryCostUsd: z.number().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  modelCosts: z.array(ModelCostEntrySchema),
});

export const CostBreakdownResponseSchema = z.object({
  planCostUsd: z.number().nonnegative(),
  phaseCosts: z.array(PhaseCostEntrySchema),
  reviewCostUsd: z.number().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  modelSummary: z.array(ModelCostEntrySchema),
});

export type CostBreakdownResponse = z.infer<typeof CostBreakdownResponseSchema>;

// GetFailureReasons 쿼리 스키마 (GET /api/stats/failure-reasons)
export const GetFailureReasonsQuerySchema = z.object({
  project: z.string().optional(),
  window: z.enum(["24h", "7d", "30d", "all"]).default("7d"),
  top: z.coerce.number().int().min(1).max(50).default(10),
}).strict();

export type GetFailureReasonsQuery = z.infer<typeof GetFailureReasonsQuerySchema>;

// FailureReasonEntry — 카테고리별 실패 집계 항목
export const FailureReasonEntrySchema = z.object({
  category: z.string(),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  recentErrors: z.array(z.string()),
});

export type FailureReasonEntry = z.infer<typeof FailureReasonEntrySchema>;

// FailureReasonsResponse 응답 타입 (GET /api/stats/failure-reasons)
export const FailureReasonsResponseSchema = z.object({
  reasons: z.array(FailureReasonEntrySchema),
  total: z.number().int().nonnegative(),
  window: z.enum(["24h", "7d", "30d", "all"]),
  project: z.string().nullable(),
});

export type FailureReasonsResponse = z.infer<typeof FailureReasonsResponseSchema>;

// GetMetrics 쿼리 스키마 (GET /api/metrics/throughput, GET /api/metrics/success-rate)
export const GetMetricsQuerySchema = z.object({
  window: z.enum(["7d", "30d", "90d"]).default("7d"),
  project: z.string().optional(),
}).strict();

export type GetMetricsQuery = z.infer<typeof GetMetricsQuerySchema>;

// ThroughputResponse 응답 타입 (GET /api/metrics/throughput)
export const ThroughputSeriesEntrySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  count: z.number().int().nonnegative(),
});

export type ThroughputSeriesEntry = z.infer<typeof ThroughputSeriesEntrySchema>;

export const ThroughputResponseSchema = z.object({
  window: z.enum(["7d", "30d", "90d"]),
  project: z.string().nullable(),
  series: z.array(ThroughputSeriesEntrySchema),
});

export type ThroughputResponse = z.infer<typeof ThroughputResponseSchema>;

// SuccessRateResponse 응답 타입 (GET /api/metrics/success-rate)
export const SuccessRateResponseSchema = z.object({
  window: z.enum(["7d", "30d", "90d"]),
  project: z.string().nullable(),
  total: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  retrySuccessCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(100),
  failureRate: z.number().min(0).max(100),
  retrySuccessRate: z.number().min(0).max(100),
});

export type SuccessRateResponse = z.infer<typeof SuccessRateResponseSchema>;

// Phase 2: zValidator용 뮤테이션 스키마 (짧은 이름으로 export)
export const configUpdateSchema = UpdateConfigRequestSchema;
export const projectCreateSchema = CreateProjectRequestSchema;
export const projectUpdateSchema = UpdateProjectRequestSchema;
export const jobPrioritySchema = UpdateJobPriorityRequestSchema;

// POST /api/jobs/:id/cancel — request body 없음
export const jobCancelSchema = z.object({}).strict();

// POST /api/jobs/:id/retry — request body 없음
export const jobRetrySchema = z.object({}).strict();

// Zod 에러를 클라이언트 친화적 형태로 변환
export function formatZodError(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}