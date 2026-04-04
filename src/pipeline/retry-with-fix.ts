import { runClaude } from "../claude/claude-runner.js";
import { configForTask } from "../claude/model-router.js";
import { autoCommitIfDirty } from "../git/commit-helper.js";
import { getLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/error-utils.js";

const logger = getLogger();

export interface RetryWithFixOptions<T> {
  /**
   * 현재 상태를 검증하는 함수
   * @returns 성공 여부와 검증 결과
   */
  checkFn: () => Promise<{ success: boolean; result: T }>;

  /**
   * 실패한 결과를 바탕으로 수정 프롬프트를 생성하는 함수
   * @param result 실패한 검증 결과
   * @returns Claude에게 전달할 수정 프롬프트
   */
  buildFixPromptFn: (result: T) => string;

  /**
   * 수정 후 재검증을 수행하는 함수
   * @returns 재검증 결과
   */
  revalidateFn: () => Promise<{ success: boolean; result: T }>;

  /** 최대 재시도 횟수 */
  maxRetries: number;

  /** Claude CLI 설정 */
  claudeConfig: any;

  /** 작업 디렉토리 */
  cwd: string;

  /** Git 실행 경로 */
  gitPath: string;

  /** 커밋 메시지 템플릿 (attempt 번호가 포함됨) */
  commitMessageTemplate: string;

  /** 재시도 시작 시 호출되는 콜백 (선택사항) */
  onAttempt?: (attempt: number, maxRetries: number, description: string) => void;

  /** 수정 성공 시 호출되는 콜백 (선택사항) */
  onSuccess?: (attempt: number, result: T) => void;

  /** 최종 실패 시 호출되는 콜백 (선택사항) */
  onFailure?: (maxRetries: number, finalResult: T) => void;
}

export interface RetryWithFixResult<T> {
  /** 최종 성공 여부 */
  success: boolean;

  /** 최종 검증 결과 */
  result: T;

  /** 실제 시도 횟수 */
  attempts: number;

  /** 실패한 경우 에러 메시지 */
  error?: string;
}

/**
 * Claude를 이용한 수정 루프를 실행하는 공통 유틸리티
 *
 * @param options 수정 루프 옵션
 * @returns 수정 루프 결과
 */
export async function retryWithClaudeFix<T>(
  options: RetryWithFixOptions<T>
): Promise<RetryWithFixResult<T>> {
  const {
    checkFn,
    buildFixPromptFn,
    revalidateFn,
    maxRetries,
    claudeConfig,
    cwd,
    gitPath,
    commitMessageTemplate,
    onAttempt,
    onSuccess,
    onFailure
  } = options;

  // 초기 검증
  const initialCheck = await checkFn();
  if (initialCheck.success) {
    return {
      success: true,
      result: initialCheck.result,
      attempts: 0
    };
  }

  let currentResult = initialCheck.result;

  // 재시도 루프
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const fixPrompt = buildFixPromptFn(currentResult);
    const description = extractDescriptionFromPrompt(fixPrompt);

    logger.info(`[RETRY_WITH_FIX] Attempt ${attempt}/${maxRetries} — fixing: ${description}`);
    onAttempt?.(attempt, maxRetries, description);

    try {
      // Claude를 이용한 수정
      await runClaude({
        prompt: fixPrompt,
        cwd,
        config: configForTask(claudeConfig, "fallback"),
      });

      // 변경사항 커밋
      const commitMessage = commitMessageTemplate.replace('{attempt}', String(attempt));
      await autoCommitIfDirty(gitPath, cwd, commitMessage);

      // 재검증
      const retryResult = await revalidateFn();
      currentResult = retryResult.result;

      if (retryResult.success) {
        logger.info(`[RETRY_WITH_FIX] Passed after attempt ${attempt}`);
        onSuccess?.(attempt, retryResult.result);

        return {
          success: true,
          result: retryResult.result,
          attempts: attempt
        };
      } else {
        logger.info(`[RETRY_WITH_FIX] Still failing after attempt ${attempt}`);
      }
    } catch (error: unknown) {
      const errMsg = getErrorMessage(error);
      logger.error(`[RETRY_WITH_FIX] Attempt ${attempt} failed: ${errMsg}`);

      // 마지막 시도에서 에러가 발생한 경우
      if (attempt === maxRetries) {
        onFailure?.(maxRetries, currentResult);
        return {
          success: false,
          result: currentResult,
          attempts: attempt,
          error: `Final attempt failed: ${errMsg}`
        };
      }
    }
  }

  // 모든 재시도가 실패한 경우
  logger.error(`[RETRY_WITH_FIX] Failed after ${maxRetries} attempts`);
  onFailure?.(maxRetries, currentResult);

  return {
    success: false,
    result: currentResult,
    attempts: maxRetries,
    error: `Failed after ${maxRetries} attempts`
  };
}

/**
 * 프롬프트에서 간단한 설명을 추출합니다.
 * @param prompt 전체 프롬프트
 * @returns 첫 번째 줄 또는 요약된 설명
 */
function extractDescriptionFromPrompt(prompt: string): string {
  const firstLine = prompt.split('\n').find(line => line.trim());
  if (!firstLine) {
    return "unknown issues";
  }

  const trimmed = firstLine.trim();
  return trimmed.length <= 50 ? trimmed : trimmed.substring(0, 47) + "...";
}