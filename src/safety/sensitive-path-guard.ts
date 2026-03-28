import { minimatch } from "minimatch";
import { SafetyViolationError } from "../types/errors.js";

/**
 * Checks if any changed files match sensitive path patterns.
 * Throws SafetyViolationError if a match is found.
 */
export function checkSensitivePaths(
  changedFiles: string[],
  sensitivePaths: string[]
): void {
  const violations: string[] = [];

  for (const file of changedFiles) {
    for (const pattern of sensitivePaths) {
      if (minimatch(file, pattern, { dot: true })) {
        violations.push(`${file} matches sensitive pattern "${pattern}"`);
      }
    }
  }

  if (violations.length > 0) {
    throw new SafetyViolationError(
      "SensitivePathGuard",
      `Sensitive files modified:\n${violations.join("\n")}`,
      { violations }
    );
  }
}
