/**
 * Pipeline progress calculator.
 *
 * Stage weights (total = 100):
 *   issueValidation   5%   (0-5)
 *   planGeneration    10%   (5-15)
 *   phaseExecution    60%   (15-75)  — divided equally among phases
 *   review            10%   (75-85)
 *   finalValidation    5%   (85-90)
 *   prCreation        10%   (90-100)
 */

/** Progress value after issue validation completes. */
export const PROGRESS_ISSUE_VALIDATED = 5;

/** Progress value after plan generation completes. */
export const PROGRESS_PLAN_GENERATED = 15;

/** Progress value when review stage starts. */
export const PROGRESS_REVIEW_START = 75;

/** Progress value when simplification stage starts. */
export const PROGRESS_SIMPLIFY_START = 80;

/** Progress value when final validation stage starts. */
export const PROGRESS_VALIDATION_START = 85;

/** Progress value after draft PR is created. */
export const PROGRESS_PR_CREATED = 95;

/** Progress value when pipeline is fully done. */
export const PROGRESS_DONE = 100;

const PHASE_EXECUTION_START = 15;
const PHASE_EXECUTION_RANGE = 60;

/**
 * Returns overall progress % at the start of a given phase.
 */
export function phaseStart(index: number, total: number): number {
  if (total <= 0) return PHASE_EXECUTION_START;
  return PHASE_EXECUTION_START + (index / total) * PHASE_EXECUTION_RANGE;
}

/**
 * Returns overall progress % combining phase index and internal phase progress.
 * @param index   - zero-based phase index
 * @param total   - total number of phases
 * @param internalPercent - 0-100 progress within the current phase (e.g. from HEARTBEAT)
 */
export function phaseProgress(index: number, total: number, internalPercent: number): number {
  if (total <= 0) return PHASE_EXECUTION_START;
  const perPhase = PHASE_EXECUTION_RANGE / total;
  return PHASE_EXECUTION_START + (index * perPhase) + (internalPercent / 100 * perPhase);
}

/** Returns progress % for a given pipeline state (for resume). */
export function progressForState(state: string): number {
  switch (state) {
    case "RECEIVED": return 0;
    case "VALIDATED": return PROGRESS_ISSUE_VALIDATED;
    case "BASE_SYNCED": return PROGRESS_ISSUE_VALIDATED;
    case "BRANCH_CREATED": return PROGRESS_ISSUE_VALIDATED;
    case "WORKTREE_CREATED": return PROGRESS_ISSUE_VALIDATED;
    case "PLAN_GENERATED": return PROGRESS_PLAN_GENERATED;
    case "REVIEWING": return PROGRESS_REVIEW_START;
    case "SIMPLIFYING": return PROGRESS_SIMPLIFY_START;
    case "FINAL_VALIDATING": return PROGRESS_VALIDATION_START;
    case "DRAFT_PR_CREATED": return PROGRESS_PR_CREATED;
    case "DONE": return PROGRESS_DONE;
    default: return 0;
  }
}
