import { checkPathsAgainstRules } from "./rule-engine.js";
import { SafetyViolationError } from "../types/errors.js";

/**
 * Checks if any changed files match sensitive path patterns.
 * Throws SafetyViolationError if a match is found.
 */
export function checkSensitivePaths(
  changedFiles: string[],
  sensitivePaths: string[]
): void {
  try {
    checkPathsAgainstRules(changedFiles, {
      allow: [],
      deny: sensitivePaths,
      strategy: "deny-first"
    });
  } catch (err: unknown) {
    if (err instanceof SafetyViolationError) {
      // Re-wrap RuleEngine errors as SensitivePathGuard errors to maintain API compatibility
      const violations = err.details?.violations;
      const violationsText = Array.isArray(violations) && violations.length > 0
        ? violations.join("\n")
        : err.message;

      throw new SafetyViolationError(
        "SensitivePathGuard",
        `Sensitive files modified:\n${violationsText}`,
        err.details
      );
    }
    throw err;
  }
}
