import type { Plan, PhaseResult, ErrorCategory, DiagnosisReport } from "../../types/pipeline.js";
import { getLogger } from "../../utils/logger.js";

export type { DiagnosisReport };

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
    costUsd?: number;
    retryCostUsd?: number;
  }>;
  totalDurationMs: number;
  prUrl?: string;
  errorCategory?: ErrorCategory;
  errorSummary?: string;
  /** Claude 기반 실패 진단 리포트 (실패 시에만 존재) */
  diagnosis?: DiagnosisReport;
  /** baseline 캡처 실패로 인해 검증이 불완전한 경우 경고 목록 */
  verificationIncomplete?: string[];
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
      costUsd: r.costUsd,
      retryCostUsd: r.retryCostUsd,
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
    const cost = phase.costUsd !== undefined ? ` $${phase.costUsd.toFixed(4)}` : "";
    const retryCost = phase.retryCostUsd ? ` +retry $${phase.retryCostUsd.toFixed(4)}` : "";
    console.log(`  ${status} ${phase.name}${commit} (${(phase.durationMs / 1000).toFixed(1)}s${cost}${retryCost})`);
  }

  if (report.prUrl) {
    console.log(`\nPR: ${report.prUrl}`);
  }

  if (report.verificationIncomplete && report.verificationIncomplete.length > 0) {
    console.log("\n[WARN] 검증 불완전: baseline 캡처 실패로 일부 검증이 누락되었을 수 있습니다.");
    for (const warning of report.verificationIncomplete) {
      console.log(`  - ${warning}`);
    }
  }

  if (report.diagnosis) {
    printDiagnosisReport(report.diagnosis);
  }

  console.log("");
}

/**
 * Prints a Claude diagnosis report in a structured box format.
 */
export function printDiagnosisReport(diagnosis: DiagnosisReport): void {
  const BORDER = "═".repeat(50);
  console.log(`\n╔${BORDER}╗`);
  console.log(`║  Claude 진단 리포트${" ".repeat(31)}║`);
  console.log(`╚${BORDER}╝`);
  console.log(`에러 카테고리 : ${diagnosis.errorCategory}`);
  console.log(`신뢰도       : ${diagnosis.confidence}`);
  console.log(`자동 재시도   : ${diagnosis.canAutoRetry ? "가능" : "불가"}`);
  if (diagnosis.retryStrategy) {
    console.log(`재시도 전략  : ${diagnosis.retryStrategy}`);
  }
  console.log(`\n원인 분석:\n  ${diagnosis.rootCause}`);
  console.log(`\n추천 액션:`);
  diagnosis.recommendedActions.forEach((action, i) => {
    console.log(`  ${i + 1}. ${action}`);
  });
  console.log(`\n생성 시각: ${diagnosis.generatedAt}`);
}
