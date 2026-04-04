import { runFinalValidation } from "./final-validator.js";
import { retryWithClaudeFix } from "./retry-with-fix.js";
import { formatResult, printResult } from "./result-reporter.js";
import { PROGRESS_VALIDATION_START } from "./progress-tracker.js";
import { configForTaskWithMode } from "../claude/model-router.js";
import type { CommandsConfig, AQConfig } from "../types/config.js";
import type { PipelineReport } from "./result-reporter.js";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { getLogger } from "../utils/logger.js";
import type { ValidationPhaseContext } from "../types/pipeline.js";
import type { ExecutionMode } from "../types/config.js";
import type { PipelineTimer } from "../safety/timeout-manager.js";

const logger = getLogger();

export interface ValidationPhaseResult {
  success: boolean;
  error?: string;
  report?: import("./result-reporter.js").PipelineReport;
}

export async function runValidationPhase(
  context: ValidationPhaseContext,
  timer: PipelineTimer,
  isPastState: (state: string) => boolean,
  skipFinalValidation: boolean,
  executionMode: ExecutionMode,
  checkpoint: (overrides?: Partial<import("./checkpoint.js").PipelineCheckpoint>) => void,
  issueNumber: number,
  repo: string,
  startTime: number,
  config: import("../types/config.js").AQConfig,
  fullCommands: CommandsConfig,
  _aqRoot?: string,
  _projectRoot?: string
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

  const validation = await runFinalValidation(fullCommands, { cwd: context.cwd }, executionMode, context.gitPath);

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
      fullCommands,
      executionMode,
      _aqRoot,
      _projectRoot
    );

    if (!retrySuccess) {
      const failedChecks = validation.checks.filter(c => !c.passed).map(c => c.name).join(", ");
      logger.error(`[FINAL_VALIDATING] Failed after ${context.maxRetries} retries: ${failedChecks}`);
      context.jl?.log(`실패: Final validation failed after ${context.maxRetries} retries: ${failedChecks}`);
      context.jl?.setStep("실패");

      checkpoint({ plan: context.plan, phaseResults: context.phaseResults });
      const report = formatResult(issueNumber, repo, context.plan, context.phaseResults, startTime);
      printResult(report);
      saveResult(config, _aqRoot ?? _projectRoot ?? process.cwd(), issueNumber, report);

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
  validation: import("./final-validator.js").ValidationResult,
  issueNumber: number,
  repo: string,
  startTime: number,
  checkpoint: (overrides?: Partial<import("./checkpoint.js").PipelineCheckpoint>) => void,
  config: import("../types/config.js").AQConfig,
  fullCommands: CommandsConfig,
  executionMode: ExecutionMode,
  _aqRoot?: string,
  _projectRoot?: string
): Promise<boolean> {

  const buildFixPromptFn = (validationResult: import("./final-validator.js").ValidationResult) => {
    const failedChecks = validationResult.checks.filter((c) => !c.passed);
    const errorDetails = failedChecks
      .map((c) => `=== ${c.name} ===\n${c.output ?? "(no output)"}`)
      .join("\n\n");

    return [
      "The following validation checks failed. Fix the errors only — do not add new features or refactor unrelated code.",
      "",
      errorDetails,
    ].join("\n");
  };

  const revalidateFn = async () => {
    const result = await runFinalValidation(fullCommands, { cwd: context.cwd }, executionMode, context.gitPath);

    // Log validation results
    for (const check of result.checks) {
      context.jl?.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}`);
    }

    return {
      success: result.success,
      result
    };
  };

  const checkFn = async () => {
    return {
      success: validation.success,
      result: validation
    };
  };

  const onAttempt = (attempt: number, maxRetries: number, _description: string) => {
    const failedNames = validation.checks
      .filter((c) => !c.passed)
      .map((c) => c.name)
      .join(", ");

    logger.info(`[FINAL_VALIDATING] Retry ${attempt}/${maxRetries} — fixing: ${failedNames}`);
    context.jl?.log(`검증 실패 수정 시도 ${attempt}/${maxRetries}: ${failedNames}`);
    context.jl?.setStep(`검증 오류 수정 중 (${attempt}/${maxRetries})...`);
  };

  const onSuccess = (attempt: number, _result: import("./final-validator.js").ValidationResult) => {
    logger.info(`[FINAL_VALIDATING] Passed after retry ${attempt}`);
    context.jl?.log(`검증 통과 (retry ${attempt})`);
  };

  const claudeConfig = configForTaskWithMode(context.commands.claudeCli, "fallback", executionMode);

  const retryResult = await retryWithClaudeFix({
    checkFn,
    buildFixPromptFn,
    revalidateFn,
    maxRetries: context.maxRetries,
    claudeConfig,
    cwd: context.cwd,
    gitPath: context.gitPath,
    commitMessageTemplate: "fix: validation 오류 수정 (retry {attempt})",
    onAttempt,
    onSuccess
  });

  return retryResult.success;
}

export function saveResult(config: AQConfig, projectRoot: string, issueNumber: number, report: PipelineReport): void {
  try {
    const logDir = resolve(projectRoot, config.general.logDir);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(
      resolve(logDir, `issue-${issueNumber}-result.json`),
      JSON.stringify(report, null, 2)
    );
  } catch {
    // non-fatal
  }
}