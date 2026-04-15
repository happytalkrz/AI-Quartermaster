import type { ErrorCategory, UserSummary } from "../../types/pipeline.js";

const USER_MESSAGE_TABLE: Record<ErrorCategory, UserSummary> = {
  TS_ERROR: {
    what: "코드에 타입 오류가 발생해 작업이 중단됐습니다.",
    why: "생성된 코드가 TypeScript 타입 규칙을 충족하지 못했습니다.",
    next: "이슈를 다시 제출하거나 관리자에게 타입 오류 내용을 전달해 주세요.",
  },
  TIMEOUT: {
    what: "작업이 제한 시간 안에 완료되지 못했습니다.",
    why: "처리해야 할 작업량이 많거나 외부 서비스 응답이 느려 시간 초과가 발생했습니다.",
    next: "잠시 후 이슈를 다시 제출해 주세요. 문제가 반복되면 관리자에게 알려주세요.",
  },
  CLI_CRASH: {
    what: "내부 도구가 예상치 못하게 종료됐습니다.",
    why: "Claude CLI 또는 관련 프로세스가 비정상 종료되었습니다.",
    next: "관리자에게 문의해 주세요. 로그에서 상세 원인을 확인할 수 있습니다.",
  },
  VERIFICATION_FAILED: {
    what: "코드는 생성됐지만 검증 단계에서 실패했습니다.",
    why: "테스트 또는 린트 검사를 통과하지 못했습니다.",
    next: "이슈 내용을 구체적으로 수정하거나 관리자에게 실패한 검증 항목을 전달해 주세요.",
  },
  SAFETY_VIOLATION: {
    what: "안전 정책에 의해 작업이 차단됐습니다.",
    why: "요청 내용이 시스템 안전 규칙을 위반했습니다.",
    next: "이슈 내용을 검토하고 안전 정책에 맞게 수정한 뒤 다시 제출해 주세요.",
  },
  RATE_LIMIT: {
    what: "API 요청 한도를 초과해 작업이 중단됐습니다.",
    why: "짧은 시간 안에 너무 많은 요청이 발생했습니다.",
    next: "잠시 후 이슈를 다시 제출해 주세요.",
  },
  PROMPT_TOO_LONG: {
    what: "요청 내용이 너무 길어 처리할 수 없었습니다.",
    why: "이슈 또는 프로젝트 컨텍스트가 AI 모델의 처리 한도를 초과했습니다.",
    next: "이슈 설명을 간결하게 줄이거나 범위를 분리해서 다시 제출해 주세요.",
  },
  MAX_TURNS_EXCEEDED: {
    what: "AI가 정해진 대화 횟수 안에 작업을 완료하지 못했습니다.",
    why: "작업이 예상보다 복잡해 반복 횟수 한도에 도달했습니다.",
    next: "이슈를 더 작은 단위로 나눠 다시 제출해 주세요.",
  },
  QUOTA_EXHAUSTED: {
    what: "현재 AI 사용 한도를 모두 소진했습니다.",
    why: "Claude 플랜의 일일/월간 사용량 한도에 도달했습니다.",
    next: "사용량이 초기화된 후 다시 시도해 주세요. 긴급한 경우 관리자에게 문의해 주세요.",
  },
  UNKNOWN: {
    what: "알 수 없는 오류로 작업이 실패했습니다.",
    why: "예상치 못한 문제가 발생했습니다.",
    next: "관리자에게 실패 로그와 함께 문의해 주세요.",
  },
};

const FALLBACK_USER_SUMMARY: UserSummary = {
  what: "알 수 없는 오류로 작업이 실패했습니다.",
  why: "예상치 못한 문제가 발생했습니다.",
  next: "관리자에게 실패 로그와 함께 문의해 주세요.",
};

/**
 * ErrorCategory에 대응하는 비개발자용 3줄 요약을 반환한다.
 * 매핑이 없는 경우 fallback 메시지를 반환한다.
 */
export function getUserSummary(category: ErrorCategory): UserSummary {
  return USER_MESSAGE_TABLE[category] ?? FALLBACK_USER_SUMMARY;
}
