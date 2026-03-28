import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { runCli, runShell } from "../utils/cli-runner.js";
import { errorMessage } from "../types/errors.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { Plan, Phase, PhaseResult } from "../types/pipeline.js";
import { classifyError } from "./error-classifier.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import type { JobLogger } from "../queue/job-logger.js";

const logger = getLogger();

export interface PhaseExecutorContext {
  issue: GitHubIssue;
  plan: Plan;
  phase: Phase;
  previousResults: PhaseResult[];
  claudeConfig: ClaudeCliConfig;
  promptsDir: string;
  cwd: string;
  testCommand: string;
  lintCommand: string;
  gitPath: string;
  projectConventions?: string;
  pastFailures?: string;
  jobLogger?: JobLogger;
}

export async function executePhase(ctx: PhaseExecutorContext): Promise<PhaseResult> {
  const startTime = Date.now();
  const jl = ctx.jobLogger;

  try {
    // 1. Load and render phase implementation template
    const templatePath = resolve(ctx.promptsDir, "phase-implementation.md");
    const template = loadTemplate(templatePath);

    const previousSummary = ctx.previousResults
      .map(r => `Phase ${r.phaseIndex}: ${r.phaseName} - ${r.success ? "SUCCESS" : "FAILED"}`)
      .join("\n");

    const rendered = renderTemplate(template, {
      issue: {
        number: String(ctx.issue.number),
        title: ctx.issue.title,
        body: ctx.issue.body,
      },
      plan: { summary: ctx.plan.problemDefinition, phases: JSON.stringify(ctx.plan.phases) },
      phase: {
        index: String(ctx.phase.index),
        name: ctx.phase.name,
        description: ctx.phase.description,
        files: ctx.phase.targetFiles,
        totalCount: String(ctx.plan.phases.length),
      },
      previousPhases: { summary: previousSummary },
      config: {
        testCommand: ctx.testCommand,
        lintCommand: ctx.lintCommand,
      },
      projectConventions: ctx.projectConventions ?? "",
      pastFailures: ctx.pastFailures ?? "",
    });

    // 2. Run Claude to implement the phase
    jl?.log(`Claude 구현 중: ${ctx.phase.name}`);
    const result = await runClaude({
      prompt: rendered,
      cwd: ctx.cwd,
      config: configForTask(ctx.claudeConfig, "phase"),
    });

    if (!result.success) {
      throw new Error(`Phase implementation failed: ${result.output}`);
    }
    jl?.log(`Claude 구현 완료: ${ctx.phase.name}`);

    // 3. Auto-commit if Claude didn't commit
    const statusResult = await runCli(ctx.gitPath, ["status", "--porcelain"], { cwd: ctx.cwd });
    if (statusResult.stdout.trim().length > 0) {
      logger.info(`Auto-committing uncommitted changes for phase ${ctx.phase.index}`);
      // Exclude Claude CLI artifacts from commit
      await runCli(ctx.gitPath, ["add", "-A", "--", ".", ":!.omc", ":!.claude"], { cwd: ctx.cwd });
      const commitMsg = `[#${ctx.issue.number}] Phase ${ctx.phase.index}: ${ctx.phase.name}`;
      await runCli(ctx.gitPath, ["commit", "-m", commitMsg, "--allow-empty"], { cwd: ctx.cwd });
    }

    // 4. Run verification (test + lint) — skip if command is empty
    if (ctx.testCommand) {
      logger.info(`Running verification for phase ${ctx.phase.index}: ${ctx.phase.name}`);
      const testResult = await runShell(ctx.testCommand, { cwd: ctx.cwd, timeout: 120000 });
      if (testResult.exitCode !== 0) {
        throw new Error(`Tests failed:\n${testResult.stdout}\n${testResult.stderr}`);
      }
    }

    // 5. Get latest commit hash
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
