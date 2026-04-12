import type { Plan, PhaseResult, ErrorCategory } from "../../types/pipeline.js";
import { getLogger } from "../../utils/logger.js";

const logger = getLogger();

export interface PipelineReport {
  issueNumber: number;
  repo: string;
  success: boolean;
  plan: {
    title: string;
    phaseCount: number;
  };
  phases: Array<{
    name: string;
    success: boolean;
    commit?: string;
    durationMs: number;
    error?: string;
    errorCategory?: ErrorCategory;
  }>;
  totalDurationMs: number;
  prUrl?: string;
  errorCategory?: ErrorCategory;
  errorSummary?: string;
}

/**
 * Formats pipeline results into a structured report.
 */
export function formatResult(
  issueNumber: number,
  repo: string,
  plan: Plan,
  phaseResults: PhaseResult[],
  startTime: number,
  prUrl?: string
): PipelineReport {
  const failedPhase = phaseResults.find(r => !r.success);
  return {
    issueNumber,
    repo,
    success: phaseResults.every(r => r.success),
    plan: {
      title: plan.title,
      phaseCount: plan.phases.length,
    },
    phases: phaseResults.map(r => ({
      name: r.phaseName,
      success: r.success,
      commit: r.commitHash?.slice(0, 8),
      durationMs: r.durationMs,
      error: r.error,
      errorCategory: r.errorCategory,
    })),
    totalDurationMs: Date.now() - startTime,
    prUrl,
    errorCategory: failedPhase?.errorCategory,
    errorSummary: failedPhase?.error?.slice(0, 500),
  };
}

/**
 * Prints pipeline results to stdout in a human-readable format.
 */
export function printResult(report: PipelineReport): void {
  logger.info("Pipeline result ready");
  console.log("\n=== AI Quartermaster Pipeline Result ===\n");
  console.log(`Issue: #${report.issueNumber} (${report.repo})`);
  console.log(`Plan: ${report.plan.title} (${report.plan.phaseCount} phases)`);
  console.log(`Result: ${report.success ? "SUCCESS" : "FAILED"}`);
  console.log(`Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s`);

  console.log("\nPhases:");
  for (const phase of report.phases) {
    const status = phase.success ? "PASS" : "FAIL";
    const commit = phase.commit ? ` [${phase.commit}]` : "";
    console.log(`  ${status} ${phase.name}${commit} (${(phase.durationMs / 1000).toFixed(1)}s)`);
  }

  if (report.prUrl) {
    console.log(`\nPR: ${report.prUrl}`);
  }
  console.log("");
}
