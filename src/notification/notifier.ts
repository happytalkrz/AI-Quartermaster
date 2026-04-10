import { runCli } from "../utils/cli-runner.js";
import { getLogger } from "../utils/logger.js";
import type { PlanRetryContext, ContextualizationInfo } from "../types/pipeline.js";

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
  options?: { ghPath?: string; dryRun?: boolean; instanceLabel?: string }
): Promise<void> {
  const instancePrefix = options?.instanceLabel ? ` [${options.instanceLabel}]` : "";
  const message = `## AI Quartermaster${instancePrefix} - PR 생성 완료\n\nDraft PR이 생성되었습니다: ${prUrl}\n\n리뷰 후 머지해 주세요.`;
  await notifyIssue(repo, issueNumber, message, options);
}

/**
 * Notifies failure on an issue.
 */
export async function notifyFailure(
  repo: string,
  issueNumber: number,
  error: string,
  options?: { ghPath?: string; dryRun?: boolean; errorCategory?: string; lastOutput?: string; rollbackInfo?: string; instanceLabel?: string }
): Promise<void> {
  const instancePrefix = options?.instanceLabel ? ` [${options.instanceLabel}]` : "";
  const category = options?.errorCategory ? `**유형**: \`${options.errorCategory}\`\n` : "";
  const output = options?.lastOutput
    ? `\n<details><summary>마지막 출력 (최대 50줄)</summary>\n\n\`\`\`\n${options.lastOutput.split("\n").slice(-50).join("\n")}\n\`\`\`\n</details>\n`
    : "";
  const rollback = options?.rollbackInfo ? `\n**롤백**: ${options.rollbackInfo}\n` : "";
  const message = `## AI Quartermaster${instancePrefix} - 파이프라인 실패\n\n자동 구현에 실패했습니다.\n\n${category}**에러**: ${error.slice(0, 500)}\n${rollback}${output}\n수동 확인이 필요합니다.`;
  await notifyIssue(repo, issueNumber, message, options);
}

/**
 * Plan 구체화 요청 코멘트를 이슈에 추가합니다.
 */
export async function notifyPlanRetryContext(
  repo: string,
  issueNumber: number,
  retryContext: PlanRetryContext,
  contextualizationInfo?: ContextualizationInfo,
  options?: { ghPath?: string; dryRun?: boolean; instanceLabel?: string }
): Promise<void> {
  const instancePrefix = options?.instanceLabel ? ` [${options.instanceLabel}]` : "";
  let message = `## AI Quartermaster${instancePrefix} - Plan 재시도 및 구체화\n\nPlan 생성에 실패하여 컨텍스트를 구체화합니다.\n\n`;

  // 재시도 정보
  message += `**재시도 정보**:\n`;
  message += `- 현재 시도: ${retryContext.currentAttempt + 1}/${retryContext.maxRetries}\n`;
  message += `- 재시도 가능: ${retryContext.canRetry ? '예' : '아니오'}\n`;

  if (retryContext.lastFailureAt) {
    message += `- 마지막 실패 시점: ${retryContext.lastFailureAt}\n`;
  }

  // 생성 히스토리
  if (retryContext.generationHistory.length > 0) {
    message += `\n**이전 시도 히스토리**:\n\n`;
    message += `| 시도 | 성공 여부 | 에러 범주 | 지속 시간 |\n`;
    message += `|------|-----------|-----------|----------|\n`;

    retryContext.generationHistory.forEach((history, index) => {
      const duration = `${history.durationMs}ms`;
      const success = history.success ? '✅' : '❌';
      const errorCategory = history.errorCategory || '-';
      message += `| ${index + 1} | ${success} | ${errorCategory} | ${duration} |\n`;
    });
  }

  // 구체화 컨텍스트 정보
  if (contextualizationInfo) {
    message += `\n## 추가된 컨텍스트 정보\n\n`;
    message += `다음 정보를 바탕으로 Plan을 재생성합니다:\n\n`;
    message += formatContextSection("🔧 함수 시그니처", contextualizationInfo.functionSignatures);
    message += formatImportSection(contextualizationInfo.importRelations);
    message += formatContextSection("📋 타입 정의", contextualizationInfo.typeDefinitions);
  }

  message += `\n---\n\n구체화된 정보를 바탕으로 Plan 재생성을 시도합니다.`;

  await notifyIssue(repo, issueNumber, message, options);
}

/**
 * 컨텍스트 섹션 (함수, 타입)을 포맷합니다.
 */
function formatContextSection(
  title: string,
  data: { [filePath: string]: string[] }
): string {
  if (Object.keys(data).length === 0) return "";

  let section = `### ${title}\n\n`;
  for (const [filePath, items] of Object.entries(data)) {
    if (items.length > 0) {
      section += `**${filePath}**:\n\`\`\`typescript\n`;
      section += items.join("\n") + "\n";
      section += `\`\`\`\n\n`;
    }
  }
  return section;
}

/**
 * Import 관계 섹션을 포맷합니다.
 */
function formatImportSection(
  data: { [filePath: string]: { imports: string[]; exports: string[] } }
): string {
  if (Object.keys(data).length === 0) return "";

  let section = `### 📦 Import 관계\n\n`;
  for (const [filePath, relations] of Object.entries(data)) {
    if (relations.imports.length > 0 || relations.exports.length > 0) {
      section += `**${filePath}**:\n`;
      if (relations.imports.length > 0) {
        section += `- Imports: ${relations.imports.join(", ")}\n`;
      }
      if (relations.exports.length > 0) {
        section += `- Exports: ${relations.exports.join(", ")}\n`;
      }
      section += "\n";
    }
  }
  return section;
}
