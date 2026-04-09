import type { AQConfig } from "../../types/config.js";

/**
 * Config source 인터페이스 — 각 소스는 partial config를 제공
 */
export interface ConfigSource {
  readonly name: string;
  load(): Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * 5단계 병합 순서 (우선순위 낮음 → 높음)
 * Managed → User → Project → CLI → Env
 */
export const SOURCE_PRIORITY_ORDER = ['managed', 'user', 'project', 'cli', 'env'] as const;

export type SourceName = typeof SOURCE_PRIORITY_ORDER[number];

/**
 * 5단계 소스 세트 — 각 소스는 선택적으로 제공
 */
export interface ConfigSources {
  managed?: ConfigSource; // 관리형 기본값 (AQM 내부)
  user?: ConfigSource;    // 사용자 레벨 설정 (~/.aqm/config.yml)
  project?: ConfigSource; // 프로젝트 레벨 설정 (config.yml + config.local.yml)
  cli?: ConfigSource;     // CLI 오버라이드
  env?: ConfigSource;     // 환경변수 오버라이드 (AQM_*)
}

export interface MergeResult {
  config: AQConfig;
  sources: SourceName[]; // 실제 로드된 소스 목록
}
