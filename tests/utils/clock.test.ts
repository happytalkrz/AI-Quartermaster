import { describe, it, expect } from "vitest";
import { systemClock, createFixedClock } from "../../src/utils/clock.js";

describe("systemClock", () => {
  it("nowIso()는 ISO 8601 형식 문자열을 반환한다", () => {
    expect(systemClock.nowIso()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("nowMs()는 Date.now() 기준 현재 시각을 반환한다", () => {
    const before = Date.now();
    const ms = systemClock.nowMs();
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("nowIso()와 nowMs()는 같은 시점을 가리킨다", () => {
    const iso = systemClock.nowIso();
    const ms = systemClock.nowMs();
    const isoMs = new Date(iso).getTime();
    expect(Math.abs(ms - isoMs)).toBeLessThan(50);
  });
});

describe("createFixedClock", () => {
  it("전달한 iso를 반복 호출해도 동일하게 반환한다", () => {
    const clock = createFixedClock("2026-01-15T12:00:00.000Z");
    expect(clock.nowIso()).toBe("2026-01-15T12:00:00.000Z");
    expect(clock.nowIso()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("nowMs()는 전달한 iso의 epoch ms를 반환한다", () => {
    const iso = "2026-01-15T12:00:00.000Z";
    const clock = createFixedClock(iso);
    expect(clock.nowMs()).toBe(new Date(iso).getTime());
  });

  it("nowIso()와 nowMs()는 정확히 동일 시점을 가리킨다", () => {
    const clock = createFixedClock("2026-06-30T23:59:59.999Z");
    expect(new Date(clock.nowIso()).getTime()).toBe(clock.nowMs());
  });

  it("유효하지 않은 iso 문자열이면 Error를 던진다", () => {
    expect(() => createFixedClock("not-a-date")).toThrow(/invalid ISO string/);
  });

  it("비정규 iso도 입력 받으면 정규화된 iso로 반환한다", () => {
    const clock = createFixedClock("2026-01-15T12:00:00Z");
    expect(clock.nowIso()).toBe("2026-01-15T12:00:00.000Z");
  });
});
