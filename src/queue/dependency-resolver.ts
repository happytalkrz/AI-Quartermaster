import { JobStore } from "./job-store.js";
import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

/**
 * Parses `depends: #11`, `depends: #11, #12`, `depends on #11` patterns
 * from an issue body. Returns a deduplicated array of issue numbers.
 */
export function parseDependencies(issueBody: string): number[] {
  if (!issueBody) return [];

  const numbers = new Set<number>();

  // Match "depends: #N, #M" or "depends on #N, #M" (case-insensitive)
  const lineRegex = /depends(?:\s+on)?\s*:?\s*((?:#\d+(?:\s*,\s*)?)+)/gi;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(issueBody)) !== null) {
    const segment = match[1];
    const numRegex = /#(\d+)/g;
    let numMatch: RegExpExecArray | null;
    while ((numMatch = numRegex.exec(segment)) !== null) {
      numbers.add(parseInt(numMatch[1], 10));
    }
  }

  return Array.from(numbers);
}

/**
 * Returns true if adding `dependencies` to `issueNumber` would create a cycle.
 * Walks the dependency chain stored in the JobStore.
 */
export function checkCircularDependency(
  issueNumber: number,
  dependencies: number[],
  store: JobStore
): boolean {
  // DFS: starting from each dependency, see if we can reach issueNumber
  const visited = new Set<number>();

  function hasCycle(current: number): boolean {
    if (current === issueNumber) return true;
    if (visited.has(current)) return false;
    visited.add(current);

    // Find any queued/running/pending job for this issue to read its dependencies
    const jobs = store.list().filter(j => j.issueNumber === current);
    for (const job of jobs) {
      if (job.dependencies) {
        for (const dep of job.dependencies) {
          if (hasCycle(dep)) return true;
        }
      }
    }
    return false;
  }

  for (const dep of dependencies) {
    visited.clear();
    if (hasCycle(dep)) return true;
  }

  return false;
}

/**
 * Checks whether all dependency issues have completed successfully.
 * Returns `{ met: true }` when all are done, or `{ met: false, pending: [...] }`
 * listing the issue numbers that are not yet complete.
 */
export function areDependenciesMet(
  dependencies: number[],
  repo: string,
  store: JobStore
): { met: boolean; pending: number[] } {
  if (dependencies.length === 0) return { met: true, pending: [] };

  const unmet: number[] = [];

  for (const issueNumber of dependencies) {
    const job = store.findCompletedByIssue(issueNumber, repo);
    if (!job) {
      unmet.push(issueNumber);
    }
  }

  return unmet.length === 0
    ? { met: true, pending: [] }
    : { met: false, pending: unmet };
}

/**
 * Checks whether all dependency PRs have been merged on GitHub.
 * Uses gh api to find PRs linked to each issue and check their merge status.
 * Returns `{ merged: true }` when all dependency PRs are merged,
 * or `{ merged: false, unmerged: [...] }` listing unmerged issue numbers.
 */
export async function checkDependencyPRsMerged(
  dependencies: number[],
  repo: string,
  ghPath: string = "gh"
): Promise<{ merged: boolean; unmerged: number[]; notFound: number[] }> {
  if (dependencies.length === 0) {
    return { merged: true, unmerged: [], notFound: [] };
  }

  const logger = getLogger();
  const unmerged: number[] = [];
  const notFound: number[] = [];

  for (const issueNumber of dependencies) {
    try {
      // Find PRs linked to this issue using gh api
      const result = await runCli(
        ghPath,
        [
          "api",
          `repos/${repo}/issues/${issueNumber}/timeline`,
          "--jq",
          ".[] | select(.event == \"cross-referenced\" and .source.issue.pull_request != null) | .source.issue.number"
        ]
      );

      if (result.exitCode !== 0) {
        logger.warn(`Failed to get timeline for issue #${issueNumber}: ${result.stderr}`);
        notFound.push(issueNumber);
        continue;
      }

      const prNumbers = result.stdout
        .trim()
        .split('\n')
        .filter(line => line.trim())
        .map(line => parseInt(line.trim(), 10))
        .filter(num => !isNaN(num));

      if (prNumbers.length === 0) {
        // No PRs found for this issue
        logger.warn(`No PRs found for issue #${issueNumber}`);
        notFound.push(issueNumber);
        continue;
      }

      // Check if any of the linked PRs are merged
      let isAnyPRMerged = false;
      for (const prNumber of prNumbers) {
        try {
          const prResult = await runCli(
            ghPath,
            [
              "api",
              `repos/${repo}/pulls/${prNumber}`,
              "--jq",
              ".merged"
            ]
          );

          if (prResult.exitCode === 0) {
            const isMerged = prResult.stdout.trim() === "true";
            if (isMerged) {
              isAnyPRMerged = true;
              break;
            }
          }
        } catch (err: unknown) {
          logger.warn(`Failed to check PR #${prNumber} merge status: ${getErrorMessage(err)}`);
        }
      }

      if (!isAnyPRMerged) {
        unmerged.push(issueNumber);
      }
    } catch (err: unknown) {
      logger.warn(`Error checking dependency PR for issue #${issueNumber}: ${getErrorMessage(err)}`);
      notFound.push(issueNumber);
    }
  }

  return {
    merged: unmerged.length === 0 && notFound.length === 0,
    unmerged,
    notFound
  };
}
