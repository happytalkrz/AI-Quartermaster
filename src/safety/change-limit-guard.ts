import { SafetyViolationError } from "../types/errors.js";

export interface ChangeLimits {
  maxFileChanges: number;
  maxInsertions: number;
  maxDeletions: number;
}

export interface ChangeStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/**
 * Checks if changes exceed configured limits.
 */
export function checkChangeLimits(
  stats: ChangeStats,
  limits: ChangeLimits
): void {
  const violations: string[] = [];

  if (stats.filesChanged > limits.maxFileChanges) {
    violations.push(`Files changed (${stats.filesChanged}) exceeds limit (${limits.maxFileChanges})`);
  }
  if (stats.insertions > limits.maxInsertions) {
    violations.push(`Insertions (${stats.insertions}) exceeds limit (${limits.maxInsertions})`);
  }
  if (stats.deletions > limits.maxDeletions) {
    violations.push(`Deletions (${stats.deletions}) exceeds limit (${limits.maxDeletions})`);
  }

  if (violations.length > 0) {
    throw new SafetyViolationError(
      "ChangeLimitGuard",
      violations.join("; "),
      { stats, limits }
    );
  }
}
