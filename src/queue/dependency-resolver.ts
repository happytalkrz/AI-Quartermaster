import { JobStore } from "./job-store.js";

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
