import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { runClaude, type ClaudeRunResult } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { runShell } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { ClaudeCliConfig, GitConfig, WorktreeConfig } from "../types/config.js";
import type { Plan, Phase, PhaseResult, ErrorCategory, ErrorHistoryEntry } from "../types/pipeline.js";
import { classifyError } from "./error-classifier.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import type { JobLogger } from "../queue/job-logger.js";
import { autoCommitIfDirty, getHeadHash } from "../git/commit-helper.js";
import { phaseProgress } from "./progress-tracker.js";
import { ensureCleanState, type WorktreeManager } from "../safety/rollback-manager.js";
import type { WorktreeInfo } from "../git/worktree-manager.js";

const logger = getLogger();

interface ErrorHistoryForTemplate {
  attempt: number;
  errorCategory: ErrorCategory;
  errorSummary: string;
}

const ERROR_SUMMARY_MAX_LENGTH = 3000;
const ERROR_MESSAGE_FIRST_PART = 200;
const ERROR_MESSAGE_LAST_PART = 100;
const ERROR_MESSAGE_THRESHOLD = 300;
const ENTRY_SIZE_ESTIMATE = 50;

function truncateErrorMessage(message: string): string {
  if (message.length <= ERROR_MESSAGE_THRESHOLD) {
    return message;
  }
  const first = message.slice(0, ERROR_MESSAGE_FIRST_PART).trim();
  const last = message.slice(-ERROR_MESSAGE_LAST_PART).trim();
  return `${first}...${last}`;
}

function prepareErrorHistoryForTemplate(errorHistory: ErrorHistoryEntry[]): ErrorHistoryForTemplate[] {
  let currentLength = 0;
  const processedEntries = [];

  for (const entry of errorHistory) {
    const errorSummary = truncateErrorMessage(entry.errorMessage.trim());
    const entryLength = errorSummary.length + ENTRY_SIZE_ESTIMATE;

    if (currentLength + entryLength > ERROR_SUMMARY_MAX_LENGTH && processedEntries.length > 0) {
      break;
    }

    processedEntries.push({
      attempt: entry.attempt,
      errorCategory: entry.errorCategory,
      errorSummary: errorSummary.replace(/\|/g, '\\|'),
    });

    currentLength += entryLength;
  }

  return processedEntries;
}

export interface PhaseRetryContext {
  issue: GitHubIssue;
  plan: Plan;
  phase: Phase;
  previousError: string;
  errorCategory: ErrorCategory;
  errorHistory?: ErrorHistoryEntry[];
  attempt: number;
  maxRetries: number;
  lastOutput?: string;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  testCommand: string;
  lintCommand: string;
  gitPath: string;
  jobLogger?: JobLogger;
  checkpoint: string;
  worktreeManager: WorktreeManager;
  worktreeInfo: WorktreeInfo;
  gitConfig: GitConfig;
  worktreeConfig: WorktreeConfig;
  slug: string;
  /** 이전 Phase 실행 결과. partial=true인 경우 성공한 파일은 보존하고 failedFiles만 재시도. */
  partialResult?: PhaseResult;
}

export async function retryPhase(ctx: PhaseRetryContext): Promise<PhaseResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const jl = ctx.jobLogger;
  let claudeResult: ClaudeRunResult | undefined;

  try {
    const isPartial = ctx.partialResult?.partial === true;

    if (isPartial) {
      logger.info(`Partial retry: skipping ensureCleanState for phase ${ctx.phase.index + 1} (attempt ${ctx.attempt})`);
    } else {
      logger.info(`Ensuring clean state before retry attempt ${ctx.attempt} for phase ${ctx.phase.index + 1}`);
      const cleanStateResult = await ensureCleanState(
        ctx.checkpoint,
        ctx.worktreeManager,
        {
          cwd: ctx.cwd,
          gitPath: ctx.gitPath,
          gitConfig: ctx.gitConfig,
          worktreeConfig: ctx.worktreeConfig,
          branchName: ctx.worktreeInfo.branch,
          issueNumber: ctx.issue.number,
          slug: ctx.slug,
          worktreePath: ctx.worktreeInfo.path
        }
      );
      ctx.worktreeInfo = cleanStateResult;
    }

    const templatePath = resolve(ctx.promptsDir, "phase-retry.md");
    const template = loadTemplate(templatePath);

    const hasErrorHistory = ctx.errorHistory && ctx.errorHistory.length > 0;
    const errorMessage = hasErrorHistory
      ? `최근 에러: ${ctx.previousError.slice(-500)}`
      : ctx.previousError.slice(-1500);
    const errorHistory = hasErrorHistory ? prepareErrorHistoryForTemplate(ctx.errorHistory!) : undefined;

    const failedFiles = isPartial && ctx.partialResult?.failedFiles?.length
      ? ctx.partialResult.failedFiles.join("\n")
      : "";

    const rendered = renderTemplate(template, {
      issue: {
        number: String(ctx.issue.number),
        title: ctx.issue.title,
      },
      phase: {
        index: String(ctx.phase.index + 1),
        name: ctx.phase.name,
        description: ctx.phase.description,
        files: ctx.phase.targetFiles,
        totalCount: String(ctx.plan.phases.length),
      },
      retry: {
        attempt: String(ctx.attempt),
        maxRetries: String(ctx.maxRetries),
        errorCategory: ctx.errorCategory,
        errorMessage,
        errorHistory: errorHistory as unknown as import("../prompt/template-renderer.js").TemplateVariables,
        lastOutput: ctx.lastOutput || "",
        isPartial: isPartial ? "true" : "",
        failedFiles,
      },
      config: {
        testCommand: ctx.testCommand,
        lintCommand: ctx.lintCommand,
      },
    });

    jl?.log(`Claude 수정 중: ${ctx.phase.name} (retry ${ctx.attempt})`);
    const totalPhases = ctx.plan.phases.length;
    const phaseIdx = ctx.phase.index;
    claudeResult = await runClaude({
      prompt: rendered,
      cwd: ctx.cwd,
      config: configForTask(ctx.claudeConfig, "fallback"),
      onStderr: jl ? (line: string) => {
        const match = line.match(/\[HEARTBEAT\].*?\((\d+)%\)/);
        if (match) {
          const pct = parseInt(match[1], 10);
          jl.setProgress(phaseProgress(phaseIdx, totalPhases, pct));
          jl.log(line.trim());
        } else if (line.includes("[HEARTBEAT]") || line.includes("[INFO]") || line.includes("[STEP]")) {
          jl.log(line.trim());
        }
      } : undefined,
    });

    if (!claudeResult.success) {
      throw new Error(`Phase retry failed: ${claudeResult.output}`);
    }

    // Auto-commit if needed
    const commitMsg = ctx.gitConfig.commitMessageTemplate
      .replace(/\{\{?issueNumber\}\}?/g, String(ctx.issue.number))
      .replace(/\{\{?phase\}\}?/g, `Phase ${ctx.phase.index + 1} fix`)
      .replace(/\{\{?summary\}\}?/g, ctx.phase.name)
      .replace(/\{\{?title\}\}?/g, `Phase ${ctx.phase.index + 1} fix: ${ctx.phase.name}`);
    const autoCommitted = await autoCommitIfDirty(ctx.gitPath, ctx.cwd, commitMsg);
    if (autoCommitted) {
      logger.info(`Auto-committing retry changes for phase ${ctx.phase.index + 1}`);
    }

    // Run verification
    if (ctx.testCommand) {
      logger.info(`Running verification after retry for phase ${ctx.phase.index + 1}`);
      const testResult = await runShell(ctx.testCommand, { cwd: ctx.cwd, timeout: 120000 });
      if (testResult.exitCode !== 0) {
        throw new Error(`Tests failed after retry:\n${testResult.stdout}\n${testResult.stderr}`);
      }
    }

    const commitHash = await getHeadHash(ctx.gitPath, ctx.cwd);

    return {
      phaseIndex: ctx.phase.index,
      phaseName: ctx.phase.name,
      success: true,
      commitHash,
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt: new Date().toISOString(),
      costUsd: claudeResult.costUsd,
    };
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    return {
      phaseIndex: ctx.phase.index,
      phaseName: ctx.phase.name,
      success: false,
      error: errMsg,
      errorCategory: classifyError(errMsg),
      lastOutput: errMsg.slice(-2000),
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt: new Date().toISOString(),
      costUsd: claudeResult?.costUsd,
    };
  }
}
