import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

/**
 * Posts a comment on a GitHub issue.
 */
export async function notifyIssue(
  repo: string,
  issueNumber: number,
  message: string,
  options?: { ghPath?: string; dryRun?: boolean }
): Promise<void> {
  if (options?.dryRun) {
    logger.info(`[DRY RUN] Would comment on #${issueNumber}: ${message.slice(0, 100)}...`);
    return;
  }

  const result = await runCli(
    options?.ghPath ?? "gh",
    ["issue", "comment", String(issueNumber), "--repo", repo, "--body", message],
    { timeout: 30000 }
  );

  if (result.exitCode !== 0) {
    logger.warn(`Failed to comment on issue #${issueNumber}: ${result.stderr}`);
  } else {
    logger.info(`Comment posted on issue #${issueNumber}`);
  }
}

/**
 * Notifies success on an issue.
 */
export async function notifySuccess(
  repo: string,
  issueNumber: number,
  prUrl: string,
  options?: { ghPath?: string; dryRun?: boolean }
): Promise<void> {
  const message = `## AI Quartermaster - PR 생성 완료\n\nDraft PR이 생성되었습니다: ${prUrl}\n\n리뷰 후 머지해 주세요.`;
  await notifyIssue(repo, issueNumber, message, options);
}

/**
 * Notifies failure on an issue.
 */
export async function notifyFailure(
  repo: string,
  issueNumber: number,
  error: string,
  options?: { ghPath?: string; dryRun?: boolean; errorCategory?: string; lastOutput?: string; rollbackInfo?: string }
): Promise<void> {
  const category = options?.errorCategory ? `**유형**: \`${options.errorCategory}\`\n` : "";
  const output = options?.lastOutput
    ? `\n<details><summary>마지막 출력 (최대 50줄)</summary>\n\n\`\`\`\n${options.lastOutput.split("\n").slice(-50).join("\n")}\n\`\`\`\n</details>\n`
    : "";
  const rollback = options?.rollbackInfo ? `\n**롤백**: ${options.rollbackInfo}\n` : "";
  const message = `## AI Quartermaster - 파이프라인 실패\n\n자동 구현에 실패했습니다.\n\n${category}**에러**: ${error.slice(0, 500)}\n${rollback}${output}\n수동 확인이 필요합니다.`;
  await notifyIssue(repo, issueNumber, message, options);
}
