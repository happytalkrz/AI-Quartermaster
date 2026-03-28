import { statSync } from "fs";
import { listWorktrees, removeWorktree } from "./worktree-manager.js";
import { getLogger } from "../utils/logger.js";
import type { GitConfig, WorktreeConfig } from "../types/config.js";

const logger = getLogger();

/**
 * Parses a duration string like "7d", "12h", "30m" to milliseconds.
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "d": return value * 24 * 60 * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "m": return value * 60 * 1000;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Cleans up worktrees older than the configured maxAge.
 * Skips the main worktree.
 */
export async function cleanOldWorktrees(
  gitConfig: GitConfig,
  worktreeConfig: WorktreeConfig,
  options: { cwd: string }
): Promise<string[]> {
  const maxAgeMs = parseDuration(worktreeConfig.maxAge);
  const now = Date.now();
  const removed: string[] = [];

  const worktrees = await listWorktrees(gitConfig, { cwd: options.cwd });

  for (const wt of worktrees) {
    // Skip main worktree (same as cwd)
    if (wt.path === options.cwd) continue;

    try {
      const stat = statSync(wt.path);
      const age = now - stat.mtimeMs;

      if (age > maxAgeMs) {
        logger.info(`Removing old worktree: ${wt.path} (age: ${Math.round(age / 86400000)}d)`);
        await removeWorktree(gitConfig, wt.path, { cwd: options.cwd, force: true });
        removed.push(wt.path);
      }
    } catch {
      // If stat fails, the worktree may already be gone
      logger.warn(`Could not stat worktree: ${wt.path}`);
    }
  }

  if (removed.length > 0) {
    logger.info(`Cleaned up ${removed.length} old worktrees`);
  } else {
    logger.info("No old worktrees to clean");
  }

  return removed;
}
