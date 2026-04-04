import type { ReviewResult, ReviewFinding, ReviewVerdict, SplitReviewInfo, SplitReviewResult } from "../types/review.js";

/**
 * 분할 리뷰 결과들을 단일 ReviewResult로 병합합니다.
 *
 * @param splitResults 분할된 리뷰 결과 배열
 * @param roundName 병합된 결과의 라운드 이름 (기본값: "Split Review")
 * @returns 병합된 단일 ReviewResult
 */
export function mergeReviewResults(
  splitResults: ReviewResult[],
  roundName: string = "Split Review"
): ReviewResult {
  if (splitResults.length === 0) {
    return {
      roundName,
      verdict: "PASS",
      findings: [],
      summary: "No review results to merge.",
      durationMs: 0,
    };
  }

  if (splitResults.length === 1) {
    return {
      ...splitResults[0],
      roundName,
    };
  }

  // findings 배열 병합 및 중복 제거
  const allFindings = splitResults.flatMap(result => result.findings);
  const uniqueFindings = deduplicateFindings(allFindings);

  // verdict 결정: 하나라도 FAIL이면 FAIL
  const verdict: ReviewVerdict = splitResults.some(result => result.verdict === "FAIL")
    ? "FAIL"
    : "PASS";

  // summary 통합
  const summaries = splitResults
    .map(result => result.summary)
    .filter(summary => summary && summary.trim() !== "");

  const summary = summaries.length > 0
    ? `Merged review from ${splitResults.length} splits:\n\n${summaries.map((s, i) => `**Split ${i + 1}**: ${s}`).join('\n\n')}`
    : `Merged review from ${splitResults.length} splits with no detailed summaries.`;

  // duration 합산
  const durationMs = splitResults.reduce((total, result) => total + result.durationMs, 0);

  return {
    roundName,
    verdict,
    findings: uniqueFindings,
    summary,
    durationMs,
  };
}

/**
 * ReviewFinding 배열에서 중복을 제거합니다.
 *
 * 중복 기준:
 * - file, line, message가 모두 동일한 경우
 * - file이나 line이 undefined인 경우, message만으로 비교
 *
 * @param findings 중복을 제거할 findings 배열
 * @returns 중복이 제거된 findings 배열
 */
export function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const result: ReviewFinding[] = [];

  for (const finding of findings) {
    const key = generateFindingKey(finding);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(finding);
    }
  }

  return result;
}

/**
 * ReviewFinding의 고유 키를 생성합니다.
 *
 * @param finding ReviewFinding 객체
 * @returns 고유 키 문자열
 */
function generateFindingKey(finding: ReviewFinding): string {
  // file과 line이 있는 경우: file:line:message
  if (finding.file && finding.line !== undefined) {
    return `${finding.file}:${finding.line}:${finding.message}`;
  }

  // file만 있는 경우: file::message
  if (finding.file) {
    return `${finding.file}::${finding.message}`;
  }

  // file이 없는 경우: ::message
  return `::${finding.message}`;
}


/**
 * SplitReviewResult 배열을 병합합니다.
 *
 * @param splitResults SplitReviewResult 배열
 * @param roundName 병합된 결과의 라운드 이름
 * @returns 병합된 ReviewResult
 */
export function mergeSplitReviewResults(
  splitResults: SplitReviewResult[],
  roundName: string = "Split Review"
): ReviewResult {
  // splitInfo를 제거하고 일반 ReviewResult로 변환
  const normalizedResults: ReviewResult[] = splitResults.map(result => ({
    roundName: result.roundName,
    verdict: result.verdict,
    findings: result.findings,
    summary: result.summary,
    durationMs: result.durationMs,
  }));

  const mergedResult = mergeReviewResults(normalizedResults, roundName);

  // 분할 정보가 있는 경우 summary에 추가 정보 포함
  if (splitResults.length > 0 && splitResults[0].splitInfo) {
    const { totalSplits, splitBy } = splitResults[0].splitInfo;
    mergedResult.summary = `Split review (${totalSplits} splits by ${splitBy}):\n\n${mergedResult.summary}`;
  }

  return mergedResult;
}