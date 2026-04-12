import { getLogger } from "../../utils/logger.js";
import type { FeasibilityCheckConfig } from "../../types/config.js";
import type { GitHubIssue } from "../../github/issue-fetcher.js";

const logger = getLogger();

export interface FeasibilityCheckResult {
  feasible: boolean;
  reason?: string;
  metrics: {
    requirementCount: number;
    fileCount: number;
    blockedKeywords: string[];
  };
}

/**
 * 이슈 본문에서 체크리스트 항목 수를 파싱합니다.
 * - [ ] 형태의 체크박스 항목을 카운트
 * - [x] 형태의 완료된 항목도 포함
 */
function parseRequirementCount(issueBody: string): number {
  const checklistPattern = /^[\s]*[-*]?\s*\[[\sx]\]/gm;
  const matches = issueBody.match(checklistPattern);
  return matches ? matches.length : 0;
}

/**
 * 이슈 본문에서 파일 경로를 추출합니다.
 * - `src/path/to/file.ts` 형태의 경로를 감지
 * - 백틱으로 감싸진 경로와 일반 텍스트의 경로 모두 포함
 */
function extractFilePaths(issueBody: string): string[] {
  const patterns = [
    // 백틱으로 감싸진 파일 경로: `src/file.ts`, `test/file.test.ts`
    /`([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`/g,
    // 일반 파일 경로: src/file.ts, tests/file.test.ts
    /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\b/g,
    // 디렉터리 언급: src/, tests/, docs/
    /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]*)\b/g
  ];

  const filePaths = new Set<string>();

  patterns.forEach(pattern => {
    const matches = issueBody.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // 백틱 제거
        const cleanPath = match.replace(/`/g, '');
        // 최소한 폴더/파일 구조를 가진 것만 포함
        if (cleanPath.includes('/') && cleanPath.length > 3) {
          filePaths.add(cleanPath);
        }
      });
    }
  });

  return Array.from(filePaths);
}

/**
 * 이슈 본문에서 복잡도 키워드를 감지합니다.
 * 대소문자를 구분하지 않고 부분 매칭을 수행합니다.
 */
function detectBlockedKeywords(issueBody: string, blockedKeywords: string[]): string[] {
  const lowerBody = issueBody.toLowerCase();
  return blockedKeywords.filter(keyword =>
    lowerBody.includes(keyword.toLowerCase())
  );
}

/**
 * 이슈의 feasibility를 체크합니다.
 *
 * @param issue - GitHub 이슈 정보
 * @param config - Feasibility check 설정
 * @returns 체크 결과와 메트릭
 */
export function checkFeasibility(
  issue: GitHubIssue,
  config: FeasibilityCheckConfig | undefined
): FeasibilityCheckResult {
  if (!config || !config.enabled) {
    logger.info("Feasibility check disabled - marking as feasible");
    return {
      feasible: true,
      metrics: {
        requirementCount: 0,
        fileCount: 0,
        blockedKeywords: []
      }
    };
  }

  const issueBody = issue.body || "";

  // 메트릭 수집
  const requirementCount = parseRequirementCount(issueBody);
  const fileCount = extractFilePaths(issueBody).length;
  const blockedKeywords = detectBlockedKeywords(issueBody, config.blockedKeywords);

  const metrics = {
    requirementCount,
    fileCount,
    blockedKeywords
  };

  logger.info(`Feasibility metrics for issue #${issue.number}: requirements=${metrics.requirementCount}, files=${metrics.fileCount}, blockedKeywords=${metrics.blockedKeywords.length}`);

  // 체크 1: 요구사항 수
  if (requirementCount > config.maxRequirements) {
    const reason = `Too many requirements (${requirementCount} > ${config.maxRequirements})`;
    logger.info(`Issue #${issue.number} unfeasible: ${reason}`);
    return { feasible: false, reason, metrics };
  }

  // 체크 2: 파일 수
  if (fileCount > config.maxFiles) {
    const reason = `Too many files affected (${fileCount} > ${config.maxFiles})`;
    logger.info(`Issue #${issue.number} unfeasible: ${reason}`);
    return { feasible: false, reason, metrics };
  }

  // 체크 3: 블록된 키워드
  if (blockedKeywords.length > 0) {
    const reason = `Blocked keywords found: ${blockedKeywords.join(', ')}`;
    logger.info(`Issue #${issue.number} unfeasible: ${reason}`);
    return { feasible: false, reason, metrics };
  }

  logger.info(`Issue #${issue.number} is feasible`);
  return { feasible: true, metrics };
}

/**
 * Unfeasible 이슈에 대한 코멘트 메시지를 생성합니다.
 */
export function generateSkipComment(
  issue: GitHubIssue,
  result: FeasibilityCheckResult,
  skipReasons: string[] | undefined
): string {
  const { reason, metrics } = result;

  let comment = `## 🤖 AI Quartermaster - Issue Skipped\n\n`;
  comment += `이 이슈는 현재 처리 범위를 벗어나 자동 처리가 어려워 skip되었습니다.\n\n`;

  comment += `**Skip 사유:** ${reason}\n\n`;

  comment += `**분석 결과:**\n`;
  comment += `- 체크리스트 항목: ${metrics.requirementCount}개\n`;
  comment += `- 영향받는 파일: ${metrics.fileCount}개\n`;
  if (metrics.blockedKeywords.length > 0) {
    comment += `- 감지된 복잡도 키워드: ${metrics.blockedKeywords.join(', ')}\n`;
  }

  comment += `\n**처리 가능한 이슈 기준:**\n`;
  (skipReasons || []).forEach(skipReason => {
    comment += `- ${skipReason}\n`;
  });

  comment += `\n이슈를 더 작은 단위로 분할하거나 범위를 축소해 주시면 자동 처리가 가능합니다.`;

  return comment;
}