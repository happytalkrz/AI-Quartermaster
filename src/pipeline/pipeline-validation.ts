import { runFinalValidation } from "./final-validator.js";
import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { saveCheckpoint } from "./checkpoint.js";
import { formatResult, printResult } from "./result-reporter.js";
import { PROGRESS_VALIDATION_START } from "./progress-tracker.js";
import type { CommandsConfig, AQConfig } from "../types/config.js";
import type { PipelineReport } from "./result-reporter.js";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { getLogger } from "../utils/logger.js";
import type { ValidationPhaseContext } from "../types/pipeline.js";
import type { PipelineTimer } from "../safety/timeout-manager.js";

const logger = getLogger();

export interface ValidationPhaseResult {
  success: boolean;
  error?: string;
  report?: any;
}

export async function runValidationPhase(
  context: ValidationPhaseContext,
  timer: PipelineTimer,
  isPastState: (state: string) => boolean,
  skipFinalValidation: boolean,
  checkpoint: (overrides?: any) => void,
  issueNumber: number,
  repo: string,
  startTime: number,
  config: any,
  fullCommands: CommandsConfig,
  aqRoot?: string,
  projectRoot?: string
): Promise<ValidationPhaseResult> {

  if (skipFinalValidation) {
    logger.info("[SKIP] Final validation is disabled");
    return { success: true };
  }

  if (isPastState("FINAL_VALIDATING")) {
    logger.info(`[SKIP] → FINAL_VALIDATING (already done)`);
    return { success: true };
  }

  timer.assertNotExpired("final-validation");
  logger.info("[FINAL_VALIDATING] Running final validation...");
  context.jl?.setStep("최종 검증 중...");
  context.jl?.setProgress(PROGRESS_VALIDATION_START);

  let validation = await runFinalValidation(context.commands, { cwd: context.cwd }, context.gitPath);

  for (const check of validation.checks) {
    context.jl?.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}`);
  }

  if (!validation.success) {
    const retrySuccess = await retryValidationWithFixes(
      context,
      validation,
      issueNumber,
      repo,
      startTime,
      checkpoint,
      config,
      aqRoot,
      projectRoot
    );

    if (!retrySuccess) {
      const failedChecks = validation.checks.filter(c => !c.passed).map(c => c.name).join(", ");
      logger.error(`[FINAL_VALIDATING] Failed after ${context.maxRetries} retries: ${failedChecks}`);
      context.jl?.log(`실패: Final validation failed after ${context.maxRetries} retries: ${failedChecks}`);
      context.jl?.setStep("실패");

      checkpoint({ plan: context.plan, phaseResults: context.phaseResults });
      const report = formatResult(issueNumber, repo, context.plan, context.phaseResults, startTime);
      printResult(report);
      saveResultToFile(config, aqRoot ?? projectRoot ?? process.cwd(), issueNumber, report);

      return {
        success: false,
        error: `Final validation failed after ${context.maxRetries} retries: ${failedChecks}`,
        report
      };
    }
  }

  checkpoint({ plan: context.plan, phaseResults: context.phaseResults });
  return { success: true };
}

async function retryValidationWithFixes(
  context: ValidationPhaseContext,
  validation: any,
  issueNumber: number,
  repo: string,
  startTime: number,
  checkpoint: (overrides?: any) => void,
  config: any,
  aqRoot?: string,
  projectRoot?: string
): Promise<boolean> {

  for (let attempt = 1; attempt <= context.maxRetries; attempt++) {
    const failedChecks = validation.checks.filter((c: any) => !c.passed);
    const failedNames = failedChecks.map((c: any) => c.name).join(", ");

    logger.info(`[FINAL_VALIDATING] Retry ${attempt}/${context.maxRetries} — fixing: ${failedNames}`);
    context.jl?.log(`검증 실패 수정 시도 ${attempt}/${context.maxRetries}: ${failedNames}`);
    context.jl?.setStep(`검증 오류 수정 중 (${attempt}/${context.maxRetries})...`);

    const errorDetails = failedChecks
      .map((c: any) => `=== ${c.name} ===\n${c.output ?? "(no output)"}`)
      .join("\n\n");

    const fixPrompt = [
      "The following validation checks failed. Fix the errors only — do not add new features or refactor unrelated code.",
      "",
      errorDetails,
    ].join("\n");

    const claudeConfig = configForTask(context.commands.claudeCli, "fallback");
    await runClaude({
      prompt: fixPrompt,
      cwd: context.cwd,
      config: claudeConfig,
    });

    await autoCommitIfDirty(context.gitPath, context.cwd, `fix: validation 오류 수정 (retry ${attempt})`);

    validation = await runFinalValidation(fullCommands, { cwd: context.cwd }, context.gitPath);
    for (const check of validation.checks) {
      context.jl?.log(`${check.passed ? "PASS" : "FAIL"} ${check.name} (retry ${attempt})`);
    }

    if (validation.success) {
      logger.info(`[FINAL_VALIDATING] Passed after retry ${attempt}`);
      context.jl?.log(`검증 통과 (retry ${attempt})`);
      return true;
    }
  }

  return false;
}

function saveResultToFile(config: AQConfig, projectRoot: string, issueNumber: number, report: PipelineReport): void {
  try {
    const logDir = resolve(projectRoot, config.general.logDir);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      resolve(logDir, `issue-${issueNumber}-result.json`),
      JSON.stringify(report, null, 2)
    );
  } catch (error) {
    logger.warn(`Failed to save result: ${error}`);
  }
}