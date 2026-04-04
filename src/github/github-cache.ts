/**
 * GitHub API 결과를 메모이제이션하는 단순 캐시 모듈
 * 파이프라인 실행 중 중복 API 호출을 방지하여 성능을 개선합니다.
 */

// 캐시 저장소 - 파이프라인 실행 동안 메모리에 유지됩니다
const cache = new Map<string, unknown>();

/**
 * 캐시에서 값을 조회합니다
 * @param key 캐시 키
 * @returns 캐시된 값이 있으면 해당 값, 없으면 undefined
 */
export function getCached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

/**
 * 캐시에 값을 저장합니다
 * @param key 캐시 키
 * @param value 저장할 값
 */
export function setCached<T>(key: string, value: T): void {
  cache.set(key, value);
}

/**
 * 전체 캐시를 정리합니다
 * 파이프라인 종료 시 메모리 누수를 방지하기 위해 호출해야 합니다
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * 현재 캐시에 저장된 항목 수를 반환합니다
 * @returns 캐시된 항목 수
 */
export function getCacheSize(): number {
  return cache.size;
}

/**
 * 특정 키가 캐시에 있는지 확인합니다
 * @param key 확인할 캐시 키
 * @returns 키가 존재하면 true, 없으면 false
 */
export function hasCached(key: string): boolean {
  return cache.has(key);
}

/**
 * 특정 키의 캐시 항목을 삭제합니다
 * @param key 삭제할 캐시 키
 * @returns 키가 존재했고 삭제되었으면 true, 없었으면 false
 */
export function deleteCached(key: string): boolean {
  return cache.delete(key);
}