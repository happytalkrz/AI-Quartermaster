import { transitionState } from "./pipeline-context.js";
import type { PipelineRuntime, OrchestratorResult } from "./pipeline-context.js";
import type { PipelineReport } from "./result-reporter.js";

export interface PipelineResultValidationContext {
  finalResult: { prUrl?: string; report: PipelineReport; totalCostUsd?: number };
  runtime: PipelineRuntime;
}

/**
 * Validate pipeline result and ensure prUrl is present
 */
export function validatePipelineResult(context: PipelineResultValidationContext): OrchestratorResult | null {
  const { finalResult, runtime } = context;

  // Verify that prUrl was successfully created
  if (!finalResult.prUrl) {
    transitionState(runtime, "FAILED");
    const errorMessage = "Pipeline completed but failed to create PR URL";
    return {
      success: false,
      state: "FAILED",
      error: errorMessage,
      report: finalResult.report,
      totalCostUsd: finalResult.totalCostUsd
    };
  }

  // Validation passed
  return null;
}