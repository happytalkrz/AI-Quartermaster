import { z } from "zod";
import { AQConfig } from "../types/config.js";


// 에러 메시지 매핑 테이블
interface ErrorMessageMapping {
  path: string;
  code?: string;
  message: string;
  solution: string;
  example?: string;
}

const ERROR_MESSAGE_MAP: ErrorMessageMapping[] = [
  // 필수 필드 누락
  {
    path: "general.projectName",
    code: "too_small",
    message: "프로젝트 이름을 입력해주세요.",
    solution: "config.yml의 general.projectName에 의미있는 프로젝트 이름을 설정하세요.",
    example: 'general:\n  projectName: "my-awesome-project"'
  },
  {
    path: "git.allowedRepos",
    code: "custom",
    message: "허용된 리포지토리가 설정되지 않았습니다.",
    solution: "config.yml의 git.allowedRepos에 작업할 리포지토리를 추가하거나 projects 섹션을 설정하세요.",
    example: 'git:\n  allowedRepos:\n    - "owner/repository-name"\n\n또는\n\nprojects:\n  - repo: "owner/repository-name"\n    path: "/path/to/local/repo"'
  },

  // 브랜치 템플릿 오류
  {
    path: "git.branchTemplate",
    message: "브랜치 템플릿에 이슈 번호 플레이스홀더가 없습니다.",
    solution: "branchTemplate에 {{issueNumber}} 또는 {issueNumber}를 포함해주세요.",
    example: 'git:\n  branchTemplate: "feature/{{issueNumber}}-{{slug}}"'
  },

  // 타입 오류
  {
    path: "general.concurrency",
    code: "invalid_type",
    message: "동시 실행 수는 양의 정수여야 합니다.",
    solution: "general.concurrency에 1 이상의 정수를 설정하세요.",
    example: 'general:\n  concurrency: 2'
  },
  {
    path: "projects.concurrency",
    code: "invalid_type",
    message: "프로젝트별 동시 실행 수는 양의 정수여야 합니다.",
    solution: "projects[].concurrency에 1 이상의 정수를 설정하세요.",
    example: 'projects:\n  - repo: "owner/repo"\n    path: "/path/to/repo"\n    concurrency: 2'
  },
  {
    path: "safety.maxPhases",
    code: "too_small",
    message: "최대 페이즈 수는 1 이상이어야 합니다.",
    solution: "safety.maxPhases에 1~20 사이의 값을 설정하세요.",
    example: 'safety:\n  maxPhases: 10'
  },
  {
    path: "safety.maxPhases",
    code: "too_big",
    message: "최대 페이즈 수는 20 이하여야 합니다.",
    solution: "safety.maxPhases에 1~20 사이의 값을 설정하세요.",
    example: 'safety:\n  maxPhases: 10'
  },

  // 시간 관련 필드
  {
    path: "general.stuckTimeoutMs",
    code: "too_small",
    message: "작업 중단 타임아웃은 최소 60초(60000ms) 이상이어야 합니다.",
    solution: "general.stuckTimeoutMs에 60000 이상의 값을 설정하세요.",
    example: 'general:\n  stuckTimeoutMs: 600000  # 10분'
  },
  {
    path: "general.pollingIntervalMs",
    code: "too_small",
    message: "폴링 주기는 최소 10초(10000ms) 이상이어야 합니다.",
    solution: "general.pollingIntervalMs에 10000 이상의 값을 설정하세요.",
    example: 'general:\n  pollingIntervalMs: 60000  # 1분'
  },

  // 경로/문자열 필드
  {
    path: "worktree.rootPath",
    code: "invalid_type",
    message: "워크트리 루트 경로는 문자열이어야 합니다.",
    solution: "worktree.rootPath에 유효한 디렉토리 경로를 설정하세요.",
    example: 'worktree:\n  rootPath: ".aq-worktrees"'
  },

  // 배열 관련
  {
    path: "safety.allowedLabels",
    code: "invalid_type",
    message: "허용된 라벨은 문자열 배열이어야 합니다.",
    solution: "safety.allowedLabels에 문자열 배열을 설정하세요.",
    example: 'safety:\n  allowedLabels:\n    - "enhancement"\n    - "bug-fix"'
  },

  // 프로젝트 설정 오류
  {
    path: "projects",
    message: "프로젝트 설정이 올바르지 않습니다.",
    solution: "projects 배열의 각 항목에 repo와 path를 정확히 설정하세요.",
    example: 'projects:\n  - repo: "owner/repository-name"\n    path: "/absolute/path/to/repo"\n    baseBranch: "main"  # optional'
  }
];

/**
 * Zod 에러를 사용자 친화적인 한국어 메시지로 변환
 */
function formatValidationError(error: z.ZodError): string {
  const messages = error.errors.map(issue => {
    const path = issue.path.join(".");
    const code = issue.code;

    // 매핑 테이블에서 해당하는 메시지 찾기
    const mapping = ERROR_MESSAGE_MAP.find(m =>
      m.path === path && (!m.code || m.code === code)
    );

    if (!mapping) {
      return `❌ ${path}: ${issue.message}`;
    }

    const parts = [`❌ ${mapping.message}`, `   해결방법: ${mapping.solution}`];
    if (mapping.example) {
      parts.push(`   예시:\n   ${mapping.example.replace(/\n/g, '\n   ')}`);
    }
    return parts.join('\n');
  });

  return messages.join("\n\n");
}

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const localeSchema = z.enum(["ko", "en"]);
const reviewFailActionSchema = z.enum(["block", "warn", "retry"]);
const mergeMethodSchema = z.enum(["merge", "squash", "rebase"]);

const generalConfigSchema = z.object({
  projectName: z.string().min(1, "projectName must be a non-empty string"),
  logLevel: logLevelSchema,
  logDir: z.string(),
  dryRun: z.boolean(),
  locale: localeSchema,
  concurrency: z.number().int().positive(),
  targetRoot: z.string().optional(),
  stuckTimeoutMs: z.number().int().min(60000),
  pollingIntervalMs: z.number().int().min(10000),
  idlePollingIntervalMs: z.number().int().min(10000).default(300000),
  idleThresholdCycles: z.number().int().min(1).default(3),
  maxJobs: z.number().int().min(1),
  autoUpdate: z.boolean(),
});

const gitConfigSchema = z.object({
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
});

const worktreeConfigSchema = z.object({
  rootPath: z.string(),
  cleanupOnSuccess: z.boolean(),
  cleanupOnFailure: z.boolean(),
  maxAge: z.string(),
  dirTemplate: z.string(),
});

const modelRoutingSchema = z.object({
  plan: z.string(),
  phase: z.string(),
  review: z.string(),
  fallback: z.string(),
});

const retryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(10),
  initialDelayMs: z.number().int().min(100),
  maxDelayMs: z.number().int().min(1000),
  jitterFactor: z.number().min(0).max(1),
});

const claudeCliConfigSchema = z.object({
  path: z.string(),
  model: z.string(),
  models: modelRoutingSchema,
  maxTurns: z.number().int().positive(),
  timeout: z.number().positive(),
  additionalArgs: z.array(z.string()),
  retry: retryConfigSchema.optional(),
});

const ghCliConfigSchema = z.object({
  path: z.string(),
  timeout: z.number().positive(),
  retry: retryConfigSchema.optional(),
});

const commandsConfigSchema = z.object({
  claudeCli: claudeCliConfigSchema,
  ghCli: ghCliConfigSchema,
  test: z.string(),
  lint: z.string(),
  build: z.string(),
  typecheck: z.string(),
  preInstall: z.string(),
  claudeMdPath: z.string(),
});

const reviewRoundSchema = z.object({
  name: z.string(),
  promptTemplate: z.string(),
  failAction: reviewFailActionSchema,
  maxRetries: z.number().int().nonnegative(),
  model: z.string().nullable(),
  blind: z.boolean().optional(),
  adversarial: z.boolean().optional(),
});

const simplifyConfigSchema = z.object({
  enabled: z.boolean(),
  promptTemplate: z.string(),
});

const reviewConfigSchema = z.object({
  enabled: z.boolean(),
  rounds: z.array(reviewRoundSchema),
  simplify: simplifyConfigSchema,
  unifiedMode: z.boolean().optional(),
});

const prConfigSchema = z.object({
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
});

const timeoutsConfigSchema = z.object({
  planGeneration: z.number().positive(),
  phaseImplementation: z.number().positive(),
  reviewRound: z.number().positive(),
  prCreation: z.number().positive(),
});

const safetyRulesSchema = z.object({
  allow: z.array(z.string()),
  deny: z.array(z.string()),
});

const safetyConfigSchema = z.object({
  sensitivePaths: z.array(z.string()),
  maxPhases: z.number().int().min(1).max(20),
  maxRetries: z.number().int().min(1).max(10),
  maxTotalDurationMs: z.number().positive(),
  maxFileChanges: z.number().int().positive(),
  maxInsertions: z.number().int().positive(),
  maxDeletions: z.number().int().positive(),
  requireTests: z.boolean(),
  blockDirectBasePush: z.boolean(),
  timeouts: timeoutsConfigSchema,
  stopConditions: z.array(z.string()),
  allowedLabels: z.array(z.string()),
  rollbackStrategy: z.enum(["none", "all", "failed-only"]),
  strict: z.boolean().default(true),
  rules: safetyRulesSchema.default({ allow: [], deny: [] }),
});

const featuresConfigSchema = z.object({
  parallelPhases: z.boolean(),
});

const projectConfigSchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().optional(),
  branchTemplate: z.string().optional(),
  mode: z.enum(["code", "content"]).optional(),
  concurrency: z.number().int().positive().optional(),
  commands: z.object({
    test: z.string(),
    lint: z.string(),
    build: z.string(),
    typecheck: z.string(),
    preInstall: z.string(),
  }).partial().optional(),
  review: z.object({
    enabled: z.boolean(),
    rounds: z.array(reviewRoundSchema),
    simplify: simplifyConfigSchema,
    unifiedMode: z.boolean().optional(),
  }).partial().optional(),
  pr: prConfigSchema.partial().optional(),
  safety: z.object({
    maxPhases: z.number().int().positive(),
    maxFileChanges: z.number().int().positive(),
  }).partial().optional(),
  pauseThreshold: z.number().int().min(1).max(100).optional(),
  pauseDurationMs: z.number().int().min(60000).optional(), // 최소 1분
}).strict();

const hooksConfigSchema = z.record(
  z.enum([
    "pre-plan",
    "post-plan",
    "pre-phase",
    "post-phase",
    "pre-review",
    "post-review",
    "pre-pr",
    "post-pr",
  ]),
  z.array(z.object({
    command: z.string().min(1),
    timeout: z.number().int().positive().optional(),
  }))
).optional();

const aqConfigSchema = z.object({
  general: generalConfigSchema,
  git: gitConfigSchema,
  worktree: worktreeConfigSchema,
  commands: commandsConfigSchema,
  review: reviewConfigSchema,
  pr: prConfigSchema,
  safety: safetyConfigSchema,
  features: featuresConfigSchema,
  executionMode: z.enum(["economy", "standard", "thorough"]),
  hooks: hooksConfigSchema,
  projects: z.array(projectConfigSchema).optional(),
}).superRefine((data, ctx) => {
  const hasAllowedRepos = data.git.allowedRepos.length > 0;
  const hasProjects = data.projects && data.projects.length > 0;
  if (!hasAllowedRepos && !hasProjects) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["git", "allowedRepos"],
      message: "allowedRepos must be a non-empty array (or configure projects instead)",
    });
  }
});

export function validateConfig(config: unknown): AQConfig {
  const result = aqConfigSchema.safeParse(config);
  if (!result.success) {
    const friendlyMessage = formatValidationError(result.error);
    throw new Error(`설정 파일에 오류가 있습니다:\n\n${friendlyMessage}`);
  }
  return result.data as AQConfig;
}
