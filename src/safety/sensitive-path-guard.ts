import { checkPathsAgainstRules } from "./rule-engine.js";
import { SafetyViolationError } from "../types/errors.js";

/**
 * 이슈 본문에서 `## 관련 파일` 섹션 아래 리스트 항목의
 * 인라인 코드(백틱) 내 파일 경로만 추출합니다.
 *
 * - fenced code block은 사전에 제거
 * - glob 패턴 포함 경로는 제외 (*, ?, [, { 포함)
 * - trim 후 literal 문자열만 반환
 */
export function parseRelatedFilesSection(issueBody: string): string[] {
  // fenced code block 제거
  const withoutFencedBlocks = issueBody.replace(/```[\s\S]*?```/g, "");

  const lines = withoutFencedBlocks.split("\n");

  // ## 관련 파일 섹션 시작 인덱스
  const sectionStart = lines.findIndex((line) => /^##\s+관련\s*파일/.test(line.trim()));
  if (sectionStart === -1) return [];

  // 다음 ## 섹션 전까지 범위 추출
  const sectionEnd = lines.findIndex((line, i) => i > sectionStart && /^##\s/.test(line));
  const sectionLines = sectionEnd === -1
    ? lines.slice(sectionStart + 1)
    : lines.slice(sectionStart + 1, sectionEnd);

  const result: string[] = [];

  for (const line of sectionLines) {
    // 리스트 항목만 처리 (-, *, + 로 시작)
    if (!/^\s*[-*+]\s/.test(line)) continue;

    // 인라인 코드 백틱 내용 추출
    const inlineCodeRegex = /`([^`]+)`/g;
    let match;
    while ((match = inlineCodeRegex.exec(line)) !== null) {
      const path = match[1].trim();
      // 빈 문자열 제외
      if (!path) continue;
      // glob 패턴 포함 경로 제외
      if (/[*?[\]{]/.test(path)) continue;
      result.push(path);
    }
  }

  return result;
}

/**
 * Checks if any changed files match sensitive path patterns.
 * Throws SafetyViolationError if a match is found.
 */
export function checkSensitivePaths(
  changedFiles: string[],
  sensitivePaths: string[]
): void {
  try {
    checkPathsAgainstRules(changedFiles, {
      allow: [],
      deny: sensitivePaths,
      strategy: "deny-first"
    });
  } catch (err: unknown) {
    if (err instanceof SafetyViolationError) {
      // Re-wrap RuleEngine errors as SensitivePathGuard errors to maintain API compatibility
      const violations = err.details?.violations;
      const violationsText = Array.isArray(violations) && violations.length > 0
        ? violations.join("\n")
        : err.message;

      throw new SafetyViolationError(
        "SensitivePathGuard",
        `Sensitive files modified:\n${violationsText}`,
        err.details
      );
    }
    throw err;
  }
}
