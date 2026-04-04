import { estimateTokenCount } from "./token-estimator.js";

/**
 * 개별 파일의 diff 정보
 */
export interface FileDiff {
  /** 파일 경로 */
  filePath: string;
  /** diff 내용 (헤더 포함) */
  diffContent: string;
  /** 추정 토큰 수 */
  estimatedTokens: number;
}

/**
 * 토큰 예산에 맞춰 그룹화된 파일 diff 배치
 */
export interface FileDiffBatch {
  /** 배치에 포함된 파일 diff들 */
  files: FileDiff[];
  /** 배치의 총 추정 토큰 수 */
  totalEstimatedTokens: number;
  /** 배치 인덱스 (0부터 시작) */
  batchIndex: number;
}

/**
 * 전체 unified diff를 파일별로 분할합니다.
 * git diff 출력의 'diff --git' 구분자를 기준으로 파일별 diff를 추출합니다.
 *
 * @param fullDiff 전체 unified diff 문자열
 * @returns 파일별로 분할된 FileDiff 배열
 */
export function splitDiffByFiles(fullDiff: string): FileDiff[] {
  if (!fullDiff || fullDiff.trim() === "") {
    return [];
  }

  // diff --git으로 시작하는 라인을 기준으로 분할
  const diffSections = fullDiff.split(/(?=^diff --git )/m).filter(section => section.trim() !== "");

  const fileDiffs: FileDiff[] = [];

  for (const section of diffSections) {
    const filePath = extractFilePathFromDiff(section);

    if (filePath) {
      const diffContent = section.trim();
      const estimatedTokens = estimateTokenCount(diffContent, 'code');

      fileDiffs.push({
        filePath,
        diffContent,
        estimatedTokens,
      });
    }
  }

  return fileDiffs;
}

function extractFilePathFromDiff(diffSection: string): string | null {
  const match = diffSection.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
  return match ? match[2] : null;
}

/**
 * 토큰 예산 내에서 파일들을 배치로 그룹화합니다.
 *
 * @param fileDiffs 파일별 diff 배열
 * @param tokenBudget 배치당 토큰 예산
 * @param additionalContent 각 배치에 추가로 포함될 내용 (이슈, 템플릿 등)
 * @returns 토큰 예산에 맞춰 그룹화된 배치 배열
 */
export function groupFilesByTokenBudget(
  fileDiffs: FileDiff[],
  tokenBudget: number,
  additionalContent: string = ""
): FileDiffBatch[] {
  if (fileDiffs.length === 0) {
    return [];
  }

  const additionalTokens = estimateTokenCount(additionalContent, 'auto');
  const effectiveBudget = tokenBudget - additionalTokens;

  // 예산이 추가 콘텐츠보다 작은 경우, 최소한의 여유를 두고 처리
  if (effectiveBudget <= 0) {
    console.warn(`Token budget (${tokenBudget}) is too small for additional content (${additionalTokens} tokens)`);
    // 추가 콘텐츠 토큰 수를 고려하여 최소 예산으로 설정
    const minimumBudget = Math.max(1000, Math.ceil(additionalTokens * 1.1));
    return groupFilesByTokenBudget(fileDiffs, minimumBudget, additionalContent);
  }

  const batches: FileDiffBatch[] = [];
  let currentBatch: FileDiff[] = [];
  let currentBatchTokens = 0;

  for (const fileDiff of fileDiffs) {
    // 현재 파일을 추가했을 때 예산을 초과하는지 확인
    const newTotal = currentBatchTokens + fileDiff.estimatedTokens;

    if (newTotal > effectiveBudget && currentBatch.length > 0) {
      // 현재 배치를 완료하고 새 배치 시작
      batches.push({
        files: [...currentBatch],
        totalEstimatedTokens: currentBatchTokens + additionalTokens,
        batchIndex: batches.length,
      });

      currentBatch = [fileDiff];
      currentBatchTokens = fileDiff.estimatedTokens;
    } else {
      // 현재 배치에 파일 추가
      currentBatch.push(fileDiff);
      currentBatchTokens = newTotal;
    }
  }

  // 마지막 배치가 있으면 추가
  if (currentBatch.length > 0) {
    batches.push({
      files: [...currentBatch],
      totalEstimatedTokens: currentBatchTokens + additionalTokens,
      batchIndex: batches.length,
    });
  }

  return batches;
}

/**
 * 배치에서 diff 내용을 결합합니다.
 *
 * @param batch 파일 diff 배치
 * @returns 결합된 diff 문자열
 */
export function combineBatchDiffs(batch: FileDiffBatch): string {
  if (batch.files.length === 0) {
    return "";
  }

  return batch.files
    .map(fileDiff => fileDiff.diffContent)
    .join("\n\n");
}

/**
 * 분할 통계 정보
 */
export interface SplitStats {
  /** 총 파일 수 */
  totalFiles: number;
  /** 총 배치 수 */
  totalBatches: number;
  /** 총 토큰 수 */
  totalTokens: number;
  /** 배치별 파일 수 분포 */
  filesPerBatch: number[];
  /** 배치별 토큰 수 분포 */
  tokensPerBatch: number[];
}

/**
 * diff 분할에 대한 통계를 생성합니다.
 *
 * @param fileDiffs 파일별 diff 배열
 * @param batches 배치 배열
 * @returns 분할 통계 정보
 */
export function generateSplitStats(fileDiffs: FileDiff[], batches: FileDiffBatch[]): SplitStats {
  const totalFiles = fileDiffs.length;
  const totalBatches = batches.length;
  const totalTokens = fileDiffs.reduce((sum, fileDiff) => sum + fileDiff.estimatedTokens, 0);

  const filesPerBatch = batches.map(batch => batch.files.length);
  const tokensPerBatch = batches.map(batch =>
    batch.files.reduce((sum, fileDiff) => sum + fileDiff.estimatedTokens, 0)
  );

  return {
    totalFiles,
    totalBatches,
    totalTokens,
    filesPerBatch,
    tokensPerBatch,
  };
}