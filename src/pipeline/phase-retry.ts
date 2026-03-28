import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { runCli, runShell } from "../utils/cli-runner.js";
import { errorMessage } from "../types/errors.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { Plan, Phase, PhaseResult, ErrorCategory } from "../types/pipeline.js";
import { classifyError } from "./error-classifier.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import type { JobLogger } from "../queue/job-logger.js";

const logger = getLogger();

export interface PhaseRetryContext {
  issue: GitHubIssue;
  plan: Plan;
  phase: Phase;
  previousError: string;
  errorCategory: ErrorCategory;
  attempt: number;
  maxRetries: number;
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  testCommand: string;
  lintCommand: string;
  gitPath: string;
  jobLogger?: JobLogger;
}

export async function retryPhase(ctx: PhaseRetryContext): Promise<PhaseResult> {
  const startTime = Date.now();
  const jl = ctx.jobLogger;

  try {
    const templatePath = resolve(ctx.promptsDir, "phase-retry.md");
    const template = loadTemplate(templatePath);

    const rendered = renderTemplate(template, {
      issue: {
        number: String(ctx.issue.number),
        title: ctx.issue.title,
      },
      phase: {
        index: String(ctx.phase.index),
        name: ctx.phase.name,
        description: ctx.phase.description,
        files: ctx.phase.targetFiles,
        totalCount: String(ctx.plan.phases.length),
      },
      retry: {
        attempt: String(ctx.attempt),
        maxRetries: String(ctx.maxRetries),
        errorCategory: ctx.errorCategory,
        errorMessage: ctx.previousError.slice(-1500),
      },
      config: {
        testCommand: ctx.testCommand,
        lintCommand: ctx.lintCommand,
      },
    });

    jl?.log(`Claude 수정 중: ${ctx.phase.name} (retry ${ctx.attempt})`);
    const result = await runClaude({
      prompt: rendered,
      cwd: ctx.cwd,
      config: configForTask(ctx.claudeConfig, "fallback"),
    });

    if (!result.success) {
      throw new Error(`Phase retry failed: ${result.output}`);
    }

    // Auto-commit if needed
    const statusResult = await runCli(ctx.gitPath, ["status", "--porcelain"], { cwd: ctx.cwd });
    if (statusResult.stdout.trim().length > 0) {
      logger.info(`Auto-committing retry changes for phase ${ctx.phase.index}`);
      await runCli(ctx.gitPath, ["add", "-A", "--", ".", ":!.omc", ":!.claude"], { cwd: ctx.cwd });
      const commitMsg = `[#${ctx.issue.number}] Phase ${ctx.phase.index} fix: ${ctx.phase.name}`;
      await runCli(ctx.gitPath, ["commit", "-m", commitMsg, "--allow-empty"], { cwd: ctx.cwd });
    }

    // Run verification
    if (ctx.testCommand) {
      logger.info(`Running verification after retry for phase ${ctx.phase.index}`);
      const testResult = await runShell(ctx.testCommand, { cwd: ctx.cwd, timeout: 120000 });
      if (testResult.exitCode !== 0) {
        throw new Error(`Tests failed after retry:\n${testResult.stdout}\n${testResult.stderr}`);
      }
    }

    const gitLog = await runCli(ctx.gitPath, ["log", "-1", "--format=%H"], { cwd: ctx.cwd });
    const commitHash = gitLog.stdout.trim();

    return {
      phaseIndex: ctx.phase.index,
      phaseName: ctx.phase.name,
      success: true,
      commitHash,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errMsg = errorMessage(error);
    return {
      phaseIndex: ctx.phase.index,
      phaseName: ctx.phase.name,
      success: false,
      error: errMsg,
      errorCategory: classifyError(errMsg),
      lastOutput: errMsg.slice(-2000),
      durationMs: Date.now() - startTime,
    };
  }
}
