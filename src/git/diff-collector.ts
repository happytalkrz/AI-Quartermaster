import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import type { GitConfig } from "../types/config.js";

const logger = getLogger();

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  changedFiles: string[];
}

/**
 * Collects diff statistics between base branch and HEAD.
 */
export async function collectDiff(
  gitConfig: GitConfig,
  baseBranch: string,
  options: { cwd: string }
): Promise<DiffStats> {
  const baseRef = `${gitConfig.remoteAlias}/${baseBranch}`;

  const [filesResult, numstatResult] = await Promise.all([
    runCli(gitConfig.gitPath, ["diff", "--name-only", `${baseRef}...HEAD`], { cwd: options.cwd }),
    runCli(gitConfig.gitPath, ["diff", "--numstat", `${baseRef}...HEAD`], { cwd: options.cwd }),
  ]);

  const changedFiles = filesResult.stdout.trim().split("\n").filter(Boolean);
  const { insertions, deletions } = parseNumstat(numstatResult.stdout);

  const stats: DiffStats = {
    filesChanged: changedFiles.length,
    insertions,
    deletions,
    changedFiles,
  };

  logger.info(`Diff: ${stats.filesChanged} files, +${stats.insertions} -${stats.deletions}`);
  return stats;
}

export function parseNumstat(numstatOutput: string): { insertions: number; deletions: number; files: string[] } {
  let insertions = 0;
  let deletions = 0;
  const files: string[] = [];
  for (const line of numstatOutput.trim().split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const ins = parseInt(parts[0], 10);
      const del = parseInt(parts[1], 10);
      if (!isNaN(ins)) insertions += ins;
      if (!isNaN(del)) deletions += del;
      if (parts[2]) files.push(parts[2]);
    }
  }
  return { insertions, deletions, files };
}

/**
 * Gets the full diff content between base branch and HEAD.
 */
export async function getDiffContent(
  gitConfig: GitConfig,
  baseBranch: string,
  options: { cwd: string }
): Promise<string> {
  const baseRef = `${gitConfig.remoteAlias}/${baseBranch}`;
  const result = await runCli(
    gitConfig.gitPath,
    ["diff", `${baseRef}...HEAD`],
    { cwd: options.cwd }
  );
  return result.stdout;
}
