import { SafetyViolationError } from "../types/errors.js";

/**
 * Checks if the plan's phase count exceeds the configured maximum.
 */
export function checkPhaseLimit(
  phaseCount: number,
  maxPhases: number
): void {
  if (phaseCount > maxPhases) {
    throw new SafetyViolationError(
      "PhaseLimitGuard",
      `Plan has ${phaseCount} phases, exceeding the maximum of ${maxPhases}`,
      { phaseCount, maxPhases }
    );
  }
}
