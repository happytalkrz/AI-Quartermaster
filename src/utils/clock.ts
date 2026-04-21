/**
 * 시간 주입 가능한 Clock 추상화.
 *
 * `new Date().toISOString()` / `Date.now()` 직접 호출을 대체해 테스트에서 시간을 고정할 수 있다.
 */
export interface Clock {
  nowIso(): string;
  nowMs(): number;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};

/**
 * 테스트용 고정 시각 Clock. nowIso/nowMs 모두 생성 시점의 iso 값을 반환한다.
 */
export function createFixedClock(iso: string): Clock {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`createFixedClock: invalid ISO string "${iso}"`);
  }
  const fixedIso = new Date(ms).toISOString();
  return {
    nowIso: () => fixedIso,
    nowMs: () => ms,
  };
}
