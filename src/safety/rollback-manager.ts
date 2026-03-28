import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import { RollbackError } from "../types/errors.js";

const logger = getLogger();

/**
 * Creates a checkpoint by returning the current HEAD commit hash.
 */
export async function createCheckpoint(
  options: { cwd: string; gitPath?: string }
): Promise<string> {
  const result = await runCli(
    options.gitPath ?? "git",
    ["rev-parse", "HEAD"],
    { cwd: options.cwd }
  );

  if (result.exitCode !== 0) {
    throw new RollbackError("unknown", `Failed to get current HEAD: ${result.stderr}`);
  }

  const hash = result.stdout.trim();
  logger.info(`Checkpoint created: ${hash.slice(0, 8)}`);
  return hash;
}

/**
 * Rolls back to a previous checkpoint (commit hash).
 */
export async function rollbackToCheckpoint(
  hash: string,
  options: { cwd: string; gitPath?: string }
): Promise<void> {
  logger.warn(`Rolling back to checkpoint ${hash.slice(0, 8)}...`);

  const result = await runCli(
    options.gitPath ?? "git",
    ["reset", "--hard", hash],
    { cwd: options.cwd }
  );

  if (result.exitCode !== 0) {
    throw new RollbackError(hash, result.stderr);
  }

  // Clean untracked files
  await runCli(
    options.gitPath ?? "git",
    ["clean", "-fd"],
    { cwd: options.cwd }
  );

  logger.info(`Rolled back to ${hash.slice(0, 8)}`);
}
