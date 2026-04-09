/**
 * GitHub API 결과를 메모이제이션하는 단순 캐시 모듈
 * 파이프라인 실행 중 중복 API 호출을 방지하여 성능을 개선합니다.
 * TTL(Time-To-Live) 기반 만료 처리를 지원합니다.
 */

/**
 * 캐시 항목 타입
 * @property value 저장된 값
 * @property expiresAt 만료 시각 (Unix ms). undefined이면 만료 없음
 */
interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

// 캐시 저장소 - 파이프라인 실행 동안 메모리에 유지됩니다
const cache = new Map<string, CacheEntry<unknown>>();

/**
 * 캐시 항목이 만료되었는지 확인합니다
 */
function isExpired(entry: CacheEntry<unknown>): boolean {
  return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
}

/**
 * 캐시에서 값을 조회합니다.
 * 만료된 항목은 삭제 후 undefined를 반환합니다.
 * @param key 캐시 키
 * @returns 캐시된 값이 있으면 해당 값, 없거나 만료되었으면 undefined
 */
export function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;
  if (isExpired(entry)) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T | undefined;
}

/**
 * 캐시에 값을 저장합니다
 * @param key 캐시 키
 * @param value 저장할 값
 * @param ttl TTL(밀리초). 지정하지 않으면 만료 없음
 */
export function setCached<T>(key: string, value: T, ttl?: number): void {
  const entry: CacheEntry<T> = {
    value,
    expiresAt: ttl !== undefined ? Date.now() + ttl : undefined,
  };
  cache.set(key, entry as CacheEntry<unknown>);
}

/**
 * 전체 캐시를 정리합니다
 * 파이프라인 종료 시 메모리 누수를 방지하기 위해 호출해야 합니다
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * 현재 캐시에 저장된 항목 수를 반환합니다 (만료 여부 무관)
 * @returns 캐시된 항목 수
 */
export function getCacheSize(): number {
  return cache.size;
}

/**
 * 특정 키가 캐시에 있는지 확인합니다.
 * 만료된 항목은 삭제 후 false를 반환합니다.
 * @param key 확인할 캐시 키
 * @returns 키가 존재하고 만료되지 않았으면 true, 없거나 만료되었으면 false
 */
export function hasCached(key: string): boolean {
  const entry = cache.get(key);
  if (entry === undefined) return false;
  if (isExpired(entry)) {
    cache.delete(key);
    return false;
  }
  return true;
}

/**
 * 특정 키의 캐시 항목을 삭제합니다
 * @param key 삭제할 캐시 키
 * @returns 키가 존재했고 삭제되었으면 true, 없었으면 false
 */
export function deleteCached(key: string): boolean {
  return cache.delete(key);
}

/**
 * 만료된 캐시 항목을 모두 제거합니다
 * @returns 제거된 항목 수
 */
export function evictExpired(): number {
  let count = 0;
  for (const [key, entry] of cache) {
    if (isExpired(entry)) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * memoize 옵션
 * @property ttl TTL(밀리초). 지정하지 않으면 만료 없음
 * @property keyFn 캐시 키 생성 함수. 기본값: JSON.stringify(args)
 */
export interface MemoizeOptions<TArgs extends unknown[]> {
  ttl?: number;
  keyFn?: (...args: TArgs) => string;
}

/**
 * async 함수를 TTL 기반 캐시로 memoize합니다.
 * 에러는 캐시하지 않으며, 동일 키의 동시 호출은 단일 실행으로 합칩니다.
 * @param fn memoize할 async 함수
 * @param options memoize 옵션 (ttl, keyFn)
 * @returns memoize된 async 함수
 */
export function memoize<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options?: MemoizeOptions<TArgs>,
): (...args: TArgs) => Promise<TReturn> {
  const inFlight = new Map<string, Promise<TReturn>>();

  return (...args: TArgs): Promise<TReturn> => {
    const key =
      options?.keyFn != null
        ? options.keyFn(...args)
        : JSON.stringify(args);

    const cached = getCached<TReturn>(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const existing = inFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const promise = fn(...args).then(
      (result) => {
        inFlight.delete(key);
        setCached(key, result, options?.ttl);
        return result;
      },
      (err: unknown) => {
        inFlight.delete(key);
        throw err;
      },
    );

    inFlight.set(key, promise);
    return promise;
  };
}
