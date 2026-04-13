import type { JobBase } from "../types/pipeline.js";
import type { StuckThresholdConfig } from "../types/config.js";

export interface ClaudeStatus {
  processAlive: boolean;
  /** ms since last Claude stream activity. -1 if no active process. */
  lastActivityMs: number;
}

export interface StuckCheckResult {
  isStuck: boolean;
  reason: string;
  elapsedMs: number;
  thresholdMs: number;
  category: string;
}

export type StepCategory =
  | "planGeneration"
  | "implementation"
  | "review"
  | "verification"
  | "publish"
  | "default";

export function mapStepToCategory(step: string | undefined): StepCategory {
  if (!step) return "default";
  const lower = step.toLowerCase();
  if (lower.includes("plan")) return "planGeneration";
  if (lower.includes("phase") || lower.includes("implementation")) return "implementation";
  if (lower.includes("review") || lower.includes("simplify")) return "review";
  if (lower.includes("validation") || lower.includes("tsc") || lower.includes("vitest")) return "verification";
  if (lower.includes("push") || lower.includes("pr") || lower.includes("publish")) return "publish";
  return "default";
}

function getCategoryThreshold(category: StepCategory, thresholds: StuckThresholdConfig): number {
  switch (category) {
    case "planGeneration": return thresholds.planGenerationMs;
    case "implementation": return thresholds.implementationMs;
    case "review": return thresholds.reviewMs;
    case "verification": return thresholds.verificationMs;
    case "publish": return thresholds.publishMs;
    default: return thresholds.defaultMs;
  }
}

/**
 * Determines whether a running job is stuck, using phase-aware thresholds.
 *
 * Mirrors the 4-stage logic in JobQueue.checkStuckJobs() but:
 * - Uses per-category thresholds derived from job.currentStep
 * - Replaces the hardcoded 5-minute activity threshold with thresholds.activityThresholdMs
 *
 * The caller is responsible for side effects (extending lastUpdatedAt, marking failure, logging).
 */
export function checkJobStuck(
  job: JobBase,
  thresholds: StuckThresholdConfig,
  claudeStatus: ClaudeStatus
): StuckCheckResult {
  const now = Date.now();
  const lastUpdate = job.lastUpdatedAt ?? job.createdAt;
  const elapsedMs = now - new Date(lastUpdate).getTime();

  const category = mapStepToCategory(job.currentStep);
  const thresholdMs = getCategoryThreshold(category, thresholds);

  if (elapsedMs <= thresholdMs) {
    return { isStuck: false, reason: "임계값 이내", elapsedMs, thresholdMs, category };
  }

  const { processAlive, lastActivityMs } = claudeStatus;

  // Stage 1: Claude process alive + recent activity → still working, extend
  if (processAlive && lastActivityMs >= 0 && lastActivityMs < thresholds.activityThresholdMs) {
    return {
      isStuck: false,
      reason: `Claude 활동 중 (${Math.round(lastActivityMs / 1000)}초 전)`,
      elapsedMs,
      thresholdMs,
      category,
    };
  }

  // Stage 2: No process but within 2x threshold → non-Claude pipeline stage (validation, push, PR)
  if (!processAlive && elapsedMs < thresholdMs * 2) {
    return {
      isStuck: false,
      reason: "Claude 프로세스 없음, 파이프라인 단계 진행 중일 수 있음",
      elapsedMs,
      thresholdMs,
      category,
    };
  }

  // Stage 3: Process alive but no recent activity → Claude stuck
  if (processAlive && (lastActivityMs < 0 || lastActivityMs >= thresholds.activityThresholdMs)) {
    const inactiveMin = Math.round(
      (lastActivityMs >= 0 ? lastActivityMs : elapsedMs) / 60000
    );
    return {
      isStuck: true,
      reason: `Claude ${inactiveMin}분간 무응답 (프로세스는 살아있으나 활동 없음)`,
      elapsedMs,
      thresholdMs,
      category,
    };
  }

  // Stage 4: No process, exceeded 2x threshold → genuinely stuck
  return {
    isStuck: true,
    reason: `파이프라인이 ${Math.round(elapsedMs / 60000)}분간 응답 없음`,
    elapsedMs,
    thresholdMs,
    category,
  };
}
