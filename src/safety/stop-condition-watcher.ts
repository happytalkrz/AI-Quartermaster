import { SafetyViolationError } from "../types/errors.js";

/**
 * Checks if any stop condition patterns appear in the given text (e.g., Claude output).
 */
export function checkStopConditions(
  text: string,
  stopConditions: string[]
): void {
  for (const condition of stopConditions) {
    if (text.includes(condition)) {
      throw new SafetyViolationError(
        "StopConditionWatcher",
        `Stop condition detected: "${condition}"`,
        { condition, textSnippet: text.slice(0, 200) }
      );
    }
  }
}
