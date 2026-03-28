import { runCli } from "../utils/cli-runner.js";
import { SafetyViolationError } from "../types/errors.js";

/**
 * Asserts that the current branch is NOT the base branch.
 */
export async function assertNotOnBaseBranch(
  baseBranch: string,
  options: { cwd: string; gitPath?: string }
): Promise<void> {
  const result = await runCli(
    options.gitPath ?? "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: options.cwd }
  );

  const currentBranch = result.stdout.trim();

  if (currentBranch === baseBranch) {
    throw new SafetyViolationError(
      "BaseBranchGuard",
      `Currently on base branch "${baseBranch}". Direct work on base branch is forbidden.`
    );
  }
}
