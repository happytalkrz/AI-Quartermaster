import { parse as parseYaml } from "yaml";
import { AQConfig } from "../../types/config.js";

/**
 * 설정 소스 로딩 컨텍스트
 */
export interface LoadContext {
  /** 프로젝트 루트 경로 (config.yml이 위치한 디렉토리) */
  projectRoot: string;
  /** AQM_* 환경변수 (env 소스에서 사용) */
  envVars?: Record<string, string | undefined>;
  /** CLI 오버라이드 옵션 */
  configOverrides?: Record<string, unknown>;
}

/**
 * 설정 소스 인터페이스 — 각 설정 소스는 이 인터페이스를 구현한다
 */
export interface ConfigSource {
  /** 소스 식별자 (로그/디버깅용) */
  readonly name: string;
  /**
   * 설정을 로드하여 partial config 객체를 반환한다.
   * 해당 소스에서 설정을 로드할 수 없으면 null 또는 빈 객체를 반환한다.
   */
  load(context: LoadContext): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

/**
 * ConfigSource.load() 결과 타입
 */
export type SourceResult = Record<string, unknown> | null;

/**
 * 전체 설정 로딩 결과
 */
export interface ConfigLoadResult {
  config: AQConfig | null;
  error?: {
    type: 'not_found' | 'yaml_syntax' | 'validation';
    message: string;
    details?: string[];
  };
}

// ---------------------------------------------------------------------------
// 공통 유틸리티
// ---------------------------------------------------------------------------

/**
 * 타입 가드: 값이 Record<string, unknown>인지 확인
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
         typeof value === "object" &&
         !Array.isArray(value);
}

/**
 * Deep merge — source를 target에 재귀 병합한다.
 * 배열은 source 값으로 대체된다 (concat 하지 않음).
 */
export function deepMerge<T = Record<string, unknown>>(target: unknown, source: unknown): T {
  if (source === null || source === undefined) {
    return target as T;
  }
  if (!isRecord(source)) {
    return source as T;
  }
  if (!isRecord(target)) {
    return source as T;
  }

  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = deepMerge(target[key], source[key]);
  }
  return result as T;
}

/**
 * YAML 에러 객체가 code 프로퍼티를 가지는지 확인하는 타입 가드
 */
function hasErrorCode(error: Error): error is Error & { code: string } {
  return 'code' in error && typeof (error as Error & { code: unknown }).code === 'string';
}

/**
 * YAML 탭 문자 에러를 사용자 친화적인 메시지로 변환
 */
function formatYamlTabError(error: unknown, filePath: string): Error {
  if (error instanceof Error &&
      error.constructor.name === 'YAMLParseError' &&
      hasErrorCode(error) &&
      error.code === 'TAB_AS_INDENT') {
    const lineMatch = error.message.match(/line (\d+)/);
    const lineNumber = lineMatch?.[1] ?? '?';

    const friendlyMessage = `❌ YAML 설정 파일에 탭 문자가 포함되어 있습니다.
   파일: ${filePath}
   위치: ${lineNumber}번째 줄

   해결방법: YAML 파일에서는 들여쓰기에 탭 문자를 사용할 수 없습니다. 탭 문자를 스페이스(공백)로 교체해주세요.

   예시:
   # 잘못된 예 (탭 문자 사용)
   general:
   →→projectName: "my-project"

   # 올바른 예 (스페이스 사용)
   general:
     projectName: "my-project"

   팁: 에디터에서 "공백 표시" 기능을 활성화하면 탭 문자와 스페이스를 구분할 수 있습니다.`;

    return new Error(friendlyMessage);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * YAML 파싱을 수행하되 탭 문자 에러를 친절하게 처리
 */
export function parseYamlSafely(content: string, filePath: string): unknown {
  try {
    return parseYaml(content);
  } catch (error: unknown) {
    throw formatYamlTabError(error, filePath);
  }
}
