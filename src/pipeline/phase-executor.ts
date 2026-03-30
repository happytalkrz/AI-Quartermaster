import { resolve } from "path";
import { renderTemplate, loadTemplate } from "../prompt/template-renderer.js";
import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { runShell } from "../utils/cli-runner.js";
import { errorMessage } from "../types/errors.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { Plan, Phase, PhaseResult } from "../types/pipeline.js";
import { classifyError } from "./error-classifier.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import type { JobLogger } from "../queue/job-logger.js";
import { autoCommitIfDirty, getHeadHash } from "../git/commit-helper.js";
import { phaseProgress } from "./progress-tracker.js";

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

    const sanitizedBody = `<USER_INPUT>\n${ctx.issue.body}\n</USER_INPUT>`;

    const rendered = renderTemplate(template, {
      issue: {
        number: String(ctx.issue.number),
        title: ctx.issue.title,
        body: sanitizedBody,
      },
      plan: { summary: ctx.plan.problemDefinition, phases: JSON.stringify(ctx.plan.phases) },
      phase: {
        index: String(ctx.phase.index + 1),
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
    const totalPhases = ctx.plan.phases.length;
    const phaseIdx = ctx.phase.index;

    // Enable agents for parallel processing
    const baseConfig = configForTask(ctx.claudeConfig, "phase");
    const configWithAgents = {
      ...baseConfig,
      additionalArgs: [...baseConfig.additionalArgs, "--enable-agents"]
    };

    const result = await runClaude({
      prompt: rendered,
      cwd: ctx.cwd,
      config: configWithAgents,
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

    if (!result.success) {
      throw new Error(`Phase implementation failed: ${result.output}`);
    }
    jl?.log(`Claude 구현 완료: ${ctx.phase.name}`);

    // 3. Auto-commit if Claude didn't commit
    const commitMsg = `[#${ctx.issue.number}] Phase ${ctx.phase.index}: ${ctx.phase.name}`;
    const autoCommitted = await autoCommitIfDirty(ctx.gitPath, ctx.cwd, commitMsg);
    if (autoCommitted) {
      logger.info(`Auto-committing uncommitted changes for phase ${ctx.phase.index}`);
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
    const commitHash = await getHeadHash(ctx.gitPath, ctx.cwd);

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
