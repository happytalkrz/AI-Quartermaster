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
 * 이슈 #734 명세 기준: maxConcurrentJobs, claudeTimeout, pollIntervalMs,
 * executionMode, instanceOwners, allowedLabels, baseBranch.
 * 순서는 UI 렌더링 순서와 동일하다.
 *
 * 미구현 필드 (AQConfig에 경로 없음):
 *   - dashboardPort: CLI --port 인자로만 지정, config 필드 없음
 *   - 알림 on/off: notification 관련 config 필드 미구현
 */
export const BASIC_FIELD_METAS: FieldMeta[] = [
  // general
  {
    key: "general.concurrency",
    type: "number",
    label: "동시 실행 수",
    helperText: "동시에 처리할 최대 이슈 수 (maxConcurrentJobs)",
    default: 1,
    min: 1,
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
    key: "general.instanceOwners",
    type: "chip-input",
    label: "인스턴스 오너",
    helperText: "이 AQM 인스턴스를 관리할 GitHub 사용자 목록",
    default: [],
  },
  // commands
  {
    key: "commands.claudeCli.timeout",
    type: "number",
    label: "Claude 타임아웃 (ms)",
    helperText: "Claude CLI 실행 최대 시간 (claudeTimeout)",
    default: 600000,
    min: 60000,
  },
  // executionMode (AQConfig 최상위 필드)
  {
    key: "executionMode",
    type: "dropdown",
    label: "실행 모드",
    helperText: "파이프라인 품질/속도 트레이드오프 (economy: 빠름, thorough: 꼼꼼함)",
    default: "standard",
    options: ["economy", "standard", "thorough"],
  },
  // safety
  {
    key: "safety.allowedLabels",
    type: "chip-input",
    label: "허용 레이블",
    helperText: "AQM이 처리할 GitHub 이슈 레이블 목록 (allowedLabels)",
    default: [],
  },
  // git
  {
    key: "git.defaultBaseBranch",
    type: "text",
    label: "기본 베이스 브랜치",
    helperText: "PR의 대상 브랜치 이름 (baseBranch)",
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

/**
 * Advanced 탭 5개 JSON 섹션의 configPath 목록.
 * 렌더러(render-settings.js)와 테스트가 공유하는 단일 소스.
 *
 * 각 항목은 AQConfig 내 실제 dotted 경로를 나타낸다.
 */
export const ADVANCED_SECTION_KEYS = [
  "hooks",
  "commands.claudeCli.retry",
  "commands.claudeCli.models",
  "allowedTools",
  "safety.sensitivePaths",
] as const;

export type AdvancedSectionKey = (typeof ADVANCED_SECTION_KEYS)[number];
