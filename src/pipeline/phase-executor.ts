import { resolve } from "path";
import { renderTemplate, loadTemplate, assembleLayeredPrompt, buildPhaseLayer } from "../prompt/template-renderer.js";
import { runClaude, type ClaudeRunResult } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { runShell } from "../utils/cli-runner.js";
import { getErrorMessage } from "../utils/error-utils.js";
import type { ClaudeCliConfig } from "../types/config.js";
import type { Plan, Phase, PhaseResult } from "../types/pipeline.js";
import { classifyError } from "./error-classifier.js";
import { parseTscOutput, parseVitestOutput } from "./verification-parser.js";
import type { GitHubIssue } from "../github/issue-fetcher.js";
import { getLogger } from "../utils/logger.js";
import type { JobLogger } from "../queue/job-logger.js";
import { autoCommitIfDirty, getHeadHash } from "../git/commit-helper.js";
import { phaseProgress } from "./progress-tracker.js";
import { analyzeTokenUsage, summarizeForBudget } from "../review/token-estimator.js";

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
  skillsContext?: string;
  pastFailures?: string;
  jobLogger?: JobLogger;
  locale?: string;
  cachedLayers?: import("../types/pipeline.js").CachedPromptLayer;  // 캐시된 레이어
  gitConfig: import("../types/config.js").GitConfig;  // commitMessageTemplate 접근용
}

export async function executePhase(ctx: PhaseExecutorContext): Promise<PhaseResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const jl = ctx.jobLogger;
  let claudeResult: ClaudeRunResult | undefined;

  try {
    // 1. Prepare prompt using cached layers if available, fallback otherwise
    const previousSummary = ctx.previousResults
      .map(r => `Phase ${r.phaseIndex}: ${r.phaseName} - ${r.success ? "SUCCESS" : "FAILED"}`)
      .join("\n");

    // Get next phase info if not the last phase
    const nextPhase = ctx.plan.phases[ctx.phase.index + 1] ?? null;

    const sanitizedBody = `<USER_INPUT>\n${ctx.issue.body.replace(/<\/USER_INPUT>/gi, "&lt;/USER_INPUT&gt;")}\n</USER_INPUT>`;

    const config = configForTask(ctx.claudeConfig, "phase");
    const modelName = config.model || ctx.claudeConfig.model;

    // Lazy-loaded fallback template (only loaded when cachedLayers is unavailable)
    let fallbackTemplate: string | undefined;

    // Assemble the full prompt for a given previousResults summary
    const renderWithSummary = (summary: string): string => {
      if (ctx.cachedLayers) {
        const phaseLayer = buildPhaseLayer({
          issue: {
            number: ctx.issue.number,
            title: ctx.issue.title,
            body: sanitizedBody,
            labels: ctx.issue.labels,
          },
          planSummary: ctx.plan.problemDefinition,
          currentPhase: {
            index: ctx.phase.index + 1,
            totalCount: ctx.plan.phases.length,
            name: ctx.phase.name,
            description: ctx.phase.description,
            targetFiles: ctx.phase.targetFiles,
          },
          previousResults: summary,
          repository: { owner: "", name: "", baseBranch: "", workBranch: "" },
          locale: ctx.locale,
        });
        return assembleLayeredPrompt(ctx.cachedLayers, phaseLayer).content;
      }

      if (!fallbackTemplate) {
        const templatePath = resolve(ctx.promptsDir, "phase-implementation.md");
        fallbackTemplate = loadTemplate(templatePath);
      }
      return renderTemplate(fallbackTemplate, {
        issue: {
          number: String(ctx.issue.number),
          title: ctx.issue.title,
          body: sanitizedBody,
        },
        plan: {
          summary: ctx.plan.problemDefinition,
          nextPhase: nextPhase ? `Next: Phase ${nextPhase.index + 1} - ${nextPhase.name}` : "This is the final phase"
        },
        phase: {
          index: String(ctx.phase.index + 1),
          name: ctx.phase.name,
          description: ctx.phase.description,
          files: ctx.phase.targetFiles,
          totalCount: String(ctx.plan.phases.length),
        },
        previousPhases: { summary },
        config: {
          testCommand: ctx.testCommand,
          lintCommand: ctx.lintCommand,
        },
        projectConventions: ctx.projectConventions ?? "",
        skillsContext: ctx.skillsContext ?? "",
        pastFailures: ctx.pastFailures ?? "",
      });
    };

    if (ctx.cachedLayers) {
      logger.info(`Using cached layers for phase ${ctx.phase.index + 1} (cache key: ${ctx.cachedLayers.cacheKey})`);
    }

    let optimizedPreviousSummary = previousSummary;
    let rendered = renderWithSummary(optimizedPreviousSummary);

    // Check token usage and optimize if budget exceeded
    const tokenUsage = analyzeTokenUsage(rendered, modelName, ctx.locale || 'en');
    if (tokenUsage.exceedsLimit) {
      logger.warn(
        `Phase ${ctx.phase.index} prompt exceeds token budget: ${tokenUsage.estimatedTokens.toLocaleString()} tokens ` +
        `(${tokenUsage.usagePercentage.toFixed(1)}% of ${tokenUsage.effectiveLimit.toLocaleString()} limit). ` +
        `Consider reducing context or simplifying requirements.`
      );

      // If previousSummary is long, try to reduce it
      if (previousSummary.length > 1000 && ctx.previousResults.length > 0) {
        logger.warn(`Attempting to reduce previousResults context to fit budget...`);
        const targetTokens = Math.floor(tokenUsage.effectiveLimit * 0.1);
        optimizedPreviousSummary = summarizeForBudget(previousSummary, targetTokens, ctx.locale || 'en');
        rendered = renderWithSummary(optimizedPreviousSummary);

        const optimizedUsage = analyzeTokenUsage(rendered, modelName, ctx.locale || 'en');
        if (!optimizedUsage.exceedsLimit) {
          logger.warn(
            `Successfully reduced prompt to ${optimizedUsage.estimatedTokens.toLocaleString()} tokens ` +
            `(${optimizedUsage.usagePercentage.toFixed(1)}% of limit) after context optimization.`
          );
        } else {
          logger.warn(
            `After optimization: ${optimizedUsage.estimatedTokens.toLocaleString()} tokens ` +
            `(${optimizedUsage.usagePercentage.toFixed(1)}% of limit) - still exceeds budget.`
          );
        }
      }
    }

    // 2. Run Claude to implement the phase
    jl?.log(`Claude 구현 중: ${ctx.phase.name}`);
    const totalPhases = ctx.plan.phases.length;
    const phaseIdx = ctx.phase.index;
    claudeResult = await runClaude({
      prompt: rendered,
      cwd: ctx.cwd,
      config,
      enableAgents: true,
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
      throw new Error(`Phase implementation failed: ${claudeResult.output}`);
    }
    jl?.log(`Claude 구현 완료: ${ctx.phase.name}`);

    // 3. Auto-commit if Claude didn't commit
    const commitMsg = ctx.gitConfig.commitMessageTemplate
      .replace(/\{\{?issueNumber\}\}?/g, String(ctx.issue.number))
      .replace(/\{\{?phase\}\}?/g, `Phase ${ctx.phase.index + 1}`)
      .replace(/\{\{?summary\}\}?/g, ctx.phase.name)
      .replace(/\{\{?title\}\}?/g, `Phase ${ctx.phase.index + 1}: ${ctx.phase.name}`);
    const autoCommitted = await autoCommitIfDirty(ctx.gitPath, ctx.cwd, commitMsg);
    if (autoCommitted) {
      logger.info(`Auto-committing uncommitted changes for phase ${ctx.phase.index}`);
    }

    // 4. Run verification (test + lint) — skip if command is empty
    if (ctx.testCommand) {
      logger.info(`Running verification for phase ${ctx.phase.index}: ${ctx.phase.name}`);
      const testResult = await runShell(ctx.testCommand, { cwd: ctx.cwd, timeout: 120000 });
      if (testResult.exitCode !== 0) {
        const output = [testResult.stdout, testResult.stderr].filter(Boolean).join("\n");

        // Detect partial vitest success: some files passed, some failed
        const vitestResult = parseVitestOutput(output);
        if (vitestResult.totalFiles > 0 && vitestResult.passedFiles.length > 0 && vitestResult.failedFiles.length > 0) {
          logger.warn(
            `Phase ${ctx.phase.index} partial success: ` +
            `${vitestResult.passedFiles.length} passed, ${vitestResult.failedFiles.length} failed`
          );
          const commitHash = await getHeadHash(ctx.gitPath, ctx.cwd);
          const errors = vitestResult.failedFiles.map(f => `FAIL: ${f}`);
          const warnings = vitestResult.failedTests.length > 0
            ? vitestResult.failedTests.map(t => `Test failed: ${t}`)
            : undefined;
          return {
            phaseIndex: ctx.phase.index,
            phaseName: ctx.phase.name,
            success: true,
            partial: true,
            errors,
            warnings,
            commitHash,
            durationMs: Date.now() - startTime,
            startedAt,
            completedAt: new Date().toISOString(),
            costUsd: claudeResult?.costUsd,
            usage: claudeResult?.usage,
          };
        }

        // Detect partial tsc success: errors only in specific files
        const tscResult = parseTscOutput(output);
        if (tscResult.hasErrors && Object.keys(tscResult.errorsByFile).length > 0 && vitestResult.totalFiles === 0) {
          logger.warn(
            `Phase ${ctx.phase.index} partial success: tsc errors in ${Object.keys(tscResult.errorsByFile).length} file(s)`
          );
          const commitHash = await getHeadHash(ctx.gitPath, ctx.cwd);
          const errors = Object.entries(tscResult.errorsByFile).flatMap(([file, msgs]) =>
            msgs.map(msg => `${file}: ${msg}`)
          );
          return {
            phaseIndex: ctx.phase.index,
            phaseName: ctx.phase.name,
            success: true,
            partial: true,
            errors,
            commitHash,
            durationMs: Date.now() - startTime,
            startedAt,
            completedAt: new Date().toISOString(),
            costUsd: claudeResult?.costUsd,
            usage: claudeResult?.usage,
          };
        }

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
      startedAt,
      completedAt: new Date().toISOString(),
      costUsd: claudeResult.costUsd,
      usage: claudeResult.usage,
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
      usage: claudeResult?.usage,
    };
  }
}
