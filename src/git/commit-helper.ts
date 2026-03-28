import { runCli } from "../utils/cli-runner.js";

/**
 * Auto-commits all dirty files (excluding .omc and .claude artifacts).
 * Returns the new commit hash if a commit was made, undefined if the tree was clean.
 */
export async function autoCommitIfDirty(
  gitPath: string,
  cwd: string,
  commitMsg: string
): Promise<string | undefined> {
  const statusResult = await runCli(gitPath, ["status", "--porcelain"], { cwd });
  if (statusResult.stdout.trim().length === 0) {
    return undefined;
  }
  await runCli(gitPath, ["add", "-A", "--", ".", ":!.omc", ":!.claude"], { cwd });
  await runCli(gitPath, ["commit", "-m", commitMsg], { cwd });
  return getHeadHash(gitPath, cwd);
}

/**
 * Returns the HEAD commit hash.
 */
export async function getHeadHash(gitPath: string, cwd: string): Promise<string> {
  const result = await runCli(gitPath, ["log", "-1", "--format=%H"], { cwd });
  return result.stdout.trim();
}
