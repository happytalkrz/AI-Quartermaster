import { z } from "zod";
import { AQConfig } from "../types/config.js";
import type { ProjectConfig } from "../types/config.js";

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
  maxJobs: z.number().int().min(1),
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

const claudeCliConfigSchema = z.object({
  path: z.string(),
  model: z.string(),
  models: modelRoutingSchema,
  maxTurns: z.number().int().positive(),
  timeout: z.number().positive(),
  additionalArgs: z.array(z.string()),
});

const ghCliConfigSchema = z.object({
  path: z.string(),
  timeout: z.number().positive(),
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
});

const simplifyConfigSchema = z.object({
  enabled: z.boolean(),
  promptTemplate: z.string(),
});

const reviewConfigSchema = z.object({
  enabled: z.boolean(),
  rounds: z.array(reviewRoundSchema),
  simplify: simplifyConfigSchema,
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
});

const projectConfigSchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().optional(),
  branchTemplate: z.string().optional(),
  mode: z.enum(["code", "content"]).optional(),
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
  }).partial().optional(),
  pr: z.object({
    targetBranch: z.string(),
    draft: z.boolean(),
  }).partial().optional(),
  safety: z.object({
    maxPhases: z.number().int().positive(),
    maxFileChanges: z.number().int().positive(),
  }).partial().optional(),
}).strict();

const aqConfigSchema = z.object({
  general: generalConfigSchema,
  git: gitConfigSchema,
  worktree: worktreeConfigSchema,
  commands: commandsConfigSchema,
  review: reviewConfigSchema,
  pr: prConfigSchema,
  safety: safetyConfigSchema,
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
    const messages = result.error.errors
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${messages}`);
  }
  return result.data as AQConfig;
}
