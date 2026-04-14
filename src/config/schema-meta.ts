/**
 * Basic 탭 화이트리스트 필드 메타데이터
 *
 * Zod 스키마에서 파생된 타입/제약 정보를 정적으로 정의한다.
 * 비개발자가 안전하게 조작할 수 있는 필드만 포함한다.
 */

export type FieldType = "number" | "toggle" | "dropdown" | "text" | "chip-input";

export interface FieldMeta {
  /** dotted config 경로 (예: "general.concurrency") */
  key: string;
  type: FieldType;
  label: string;
  helperText?: string;
  default?: unknown;
  min?: number;
  max?: number;
  /** dropdown 타입일 때 선택 가능한 값 목록 */
  options?: string[];
}

/**
 * Basic 탭에 표시할 화이트리스트 필드 메타데이터 목록.
 * 순서는 UI 렌더링 순서와 동일하다.
 */
export const BASIC_FIELD_METAS: FieldMeta[] = [
  // general
  {
    key: "general.concurrency",
    type: "number",
    label: "동시 실행 수",
    helperText: "동시에 처리할 최대 이슈 수",
    default: 1,
    min: 1,
  },
  {
    key: "general.logLevel",
    type: "dropdown",
    label: "로그 레벨",
    helperText: "서버 로그 출력 수준",
    default: "info",
    options: ["debug", "info", "warn", "error"],
  },
  {
    key: "general.dryRun",
    type: "toggle",
    label: "Dry Run",
    helperText: "활성화 시 실제 변경 없이 시뮬레이션만 실행",
    default: false,
  },
  {
    key: "general.pollingIntervalMs",
    type: "number",
    label: "폴링 주기 (ms)",
    helperText: "GitHub 이슈 확인 주기 (최소 10,000ms)",
    default: 60000,
    min: 10000,
  },
  {
    key: "general.maxJobs",
    type: "number",
    label: "최대 잡 보관 수",
    helperText: "히스토리에 보관할 최대 잡 수",
    default: 500,
    min: 1,
  },
  // safety
  {
    key: "safety.maxPhases",
    type: "number",
    label: "최대 Phase 수",
    helperText: "이슈 하나당 허용할 최대 Phase 수 (1–20)",
    default: 10,
    min: 1,
    max: 20,
  },
  {
    key: "safety.maxRetries",
    type: "number",
    label: "최대 재시도 횟수",
    helperText: "Phase 실패 시 재시도 최대 횟수 (1–10)",
    default: 3,
    min: 1,
    max: 10,
  },
  {
    key: "safety.requireTests",
    type: "toggle",
    label: "테스트 필수",
    helperText: "활성화 시 테스트 없는 PR 생성 차단",
    default: false,
  },
  {
    key: "safety.maxFileChanges",
    type: "number",
    label: "최대 파일 변경 수",
    helperText: "한 번의 파이프라인에서 변경 가능한 최대 파일 수",
    default: 50,
    min: 1,
  },
  // review
  {
    key: "review.enabled",
    type: "toggle",
    label: "코드 리뷰 활성화",
    helperText: "활성화 시 PR 생성 전 자동 리뷰 실행",
    default: true,
  },
  // git
  {
    key: "git.defaultBaseBranch",
    type: "text",
    label: "기본 베이스 브랜치",
    helperText: "PR의 대상 브랜치 이름",
    default: "main",
  },
];

/**
 * Basic 탭 필드 메타데이터를 반환한다.
 * 프론트엔드 GET /api/config/schema-meta 응답에 사용.
 */
export function getBasicFieldMetas(): FieldMeta[] {
  return BASIC_FIELD_METAS;
}
