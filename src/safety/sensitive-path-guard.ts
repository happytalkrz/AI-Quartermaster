import { minimatch } from "minimatch";
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

/** 파일별 판정 결과 */
export interface SensitivePathAuditEntry {
  file: string;
  matchedPattern: string | null;
  decision: "allowed" | "blocked";
  reason: "no-match" | "related-file" | "allow-ci-label" | "sensitive-violation";
}

/** checkSensitivePaths 확장 옵션 */
export interface CheckSensitivePathsOptions {
  issueBody?: string;
  labels?: string[];
}

const WORKFLOW_PATTERN = ".github/workflows/**";
const MINIMATCH_OPTS = { dot: true };

/**
 * Checks if any changed files match sensitive path patterns.
 *
 * 파일별 독립 판정 매트릭스 (5단계):
 * 1. 민감 패턴 비매칭 → allowed (no-match)
 * 2. 이슈 본문 `## 관련 파일` 명시 경로 → allowed (related-file)
 * 3. `.github/workflows/**` + allow-ci 라벨 → allowed (allow-ci-label)
 * 4. 그 외 민감 패턴 매칭 → blocked (sensitive-violation)
 * 5. 차단 파일 존재 시 SafetyViolationError (수정 가이드 포함)
 *
 * 기존 시그니처(changedFiles, sensitivePaths)도 하위 호환 유지.
 */
export function checkSensitivePaths(
  changedFiles: string[],
  sensitivePaths: string[],
  options?: CheckSensitivePathsOptions
): SensitivePathAuditEntry[] {
  const relatedFiles = options?.issueBody
    ? parseRelatedFilesSection(options.issueBody)
    : [];
  const labels = options?.labels ?? [];
  const hasAllowCi = labels.includes("allow-ci");

  const auditLog: SensitivePathAuditEntry[] = [];
  const blockedFiles: string[] = [];

  for (const file of changedFiles) {
    const matchedPattern =
      sensitivePaths.find((p) => minimatch(file, p, MINIMATCH_OPTS)) ?? null;

    // 1. 민감 패턴 비매칭
    if (!matchedPattern) {
      auditLog.push({ file, matchedPattern: null, decision: "allowed", reason: "no-match" });
      continue;
    }

    // 2. 이슈 본문 관련 파일로 명시된 경우
    if (relatedFiles.includes(file)) {
      auditLog.push({ file, matchedPattern, decision: "allowed", reason: "related-file" });
      continue;
    }

    // 3. allow-ci 라벨 — .github/workflows/** 패턴에만 스코핑
    if (hasAllowCi && minimatch(file, WORKFLOW_PATTERN, MINIMATCH_OPTS)) {
      auditLog.push({ file, matchedPattern, decision: "allowed", reason: "allow-ci-label" });
      continue;
    }

    // 4. 차단
    auditLog.push({ file, matchedPattern, decision: "blocked", reason: "sensitive-violation" });
    blockedFiles.push(file);
  }

  // 5. 차단 파일이 있으면 수정 가이드 포함 에러 throw
  if (blockedFiles.length > 0) {
    const guide = buildBlockGuideMessage(blockedFiles, hasAllowCi);
    throw new SafetyViolationError(
      "SensitivePathGuard",
      guide,
      { violations: blockedFiles, auditLog }
    );
  }

  return auditLog;
}

function buildBlockGuideMessage(blockedFiles: string[], hasAllowCi: boolean): string {
  const lines: string[] = [
    `Sensitive files modified:\n${blockedFiles.join("\n")}`,
    "\nTo allow these files, add the missing paths under `## 관련 파일` in the issue body:",
  ];

  for (const f of blockedFiles) {
    lines.push(`  - \`${f}\``);
  }

  const workflowBlocked = blockedFiles.filter((f) =>
    minimatch(f, WORKFLOW_PATTERN, MINIMATCH_OPTS)
  );
  if (workflowBlocked.length > 0 && !hasAllowCi) {
    lines.push("\nFor workflow files, you can also add the `allow-ci` label to the issue.");
  }

  return lines.join("\n");
}
