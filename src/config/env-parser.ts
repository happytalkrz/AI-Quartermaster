/**
 * AQM_* 환경변수를 파싱하여 nested config 객체로 변환하는 모듈
 *
 * 네이밍 컨벤션: AQM_SECTION_KEY_NAME → section.keyName (camelCase 변환)
 * 타입 변환: 숫자/불리언/배열(콤마 구분) 자동 감지
 */

/**
 * 언더스코어로 구분된 키를 camelCase로 변환
 * @param key - 언더스코어로 구분된 키 (예: PROJECT_NAME)
 * @returns camelCase 키 (예: projectName)
 */
function toCamelCase(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
}

/**
 * 값의 타입을 자동 감지하고 변환
 * @param value - 문자열 값
 * @returns 변환된 값 (string | number | boolean | string[])
 */
function parseValue(value: string): string | number | boolean | string[] {
  // 빈 문자열
  if (value === '') {
    return '';
  }

  // 불리언
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }

  // 숫자 (정수/부동소수점)
  const numValue = Number(value);
  if (!isNaN(numValue) && value.trim() !== '') {
    return numValue;
  }

  // 배열 (콤마로 구분)
  if (value.includes(',')) {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item !== ''); // 빈 요소 제거
  }

  // 문자열 (기본값)
  return value;
}

/**
 * 객체에 중첩된 경로로 값을 설정
 * @param obj - 대상 객체
 * @param path - 설정할 경로 (예: ['general', 'projectName'])
 * @param value - 설정할 값
 */
function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) return;

  if (path.length === 1) {
    obj[path[0]] = value;
    return;
  }

  const [head, ...tail] = path;
  if (!(head in obj) || !isRecord(obj[head])) {
    obj[head] = {};
  }

  setNestedValue(obj[head] as Record<string, unknown>, tail, value);
}

/**
 * 타입 가드: 값이 Record<string, unknown>인지 확인
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null &&
         typeof value === "object" &&
         !Array.isArray(value);
}

/**
 * AQM_* 환경변수를 파싱하여 config 객체로 변환
 * @param env - 환경변수 객체 (기본값: process.env)
 * @returns 파싱된 config 객체
 */
export function parseEnvVars(env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const AQM_PREFIX = 'AQM_';

  for (const [key, value] of Object.entries(env)) {
    // AQM_ 접두사가 있는 환경변수만 처리
    if (!key.startsWith(AQM_PREFIX) || value === undefined) {
      continue;
    }

    // AQM_ 접두사 제거 후 분리
    const withoutPrefix = key.slice(AQM_PREFIX.length);
    const parts = withoutPrefix.split('_');

    if (parts.length < 2) {
      // 최소 SECTION_KEY 형태여야 함
      continue;
    }

    // 첫 번째 부분은 섹션, 나머지는 키
    const section = parts[0].toLowerCase();
    const keyParts = parts.slice(1);
    const camelKey = toCamelCase(keyParts.join('_'));

    // 값 파싱 및 설정
    const parsedValue = parseValue(value);
    setNestedValue(config, [section, camelKey], parsedValue);
  }

  return config;
}

/**
 * 특정 섹션의 환경변수만 파싱
 * @param section - 섹션 이름 (예: 'general', 'safety')
 * @param env - 환경변수 객체 (기본값: process.env)
 * @returns 해당 섹션의 파싱된 config 객체
 */
export function parseEnvSection(section: string, env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  const allConfig = parseEnvVars(env);
  return (allConfig[section.toLowerCase()] as Record<string, unknown>) || {};
}

/**
 * 현재 설정된 AQM_* 환경변수 목록을 반환
 * @param env - 환경변수 객체 (기본값: process.env)
 * @returns AQM_* 환경변수의 키 목록
 */
export function listAQMEnvVars(env: Record<string, string | undefined> = process.env): string[] {
  const AQM_PREFIX = 'AQM_';
  return Object.keys(env)
    .filter(key => key.startsWith(AQM_PREFIX))
    .sort();
}