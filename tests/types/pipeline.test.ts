import { describe, it, expect } from "vitest";
import type { PhaseResult } from "../../src/types/pipeline.js";

describe("PhaseResult", () => {
  it("최소 필수 필드만으로 성공 결과를 생성할 수 있다", () => {
    const result: PhaseResult = {
      phaseIndex: 0,
      phaseName: "구현",
      success: true,
      durationMs: 1000,
    };
    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
    expect(result.errors).toBeUndefined();
    expect(result.partial).toBeUndefined();
  });

  it("warnings 필드에 경고 메시지 목록을 담을 수 있다", () => {
    const result: PhaseResult = {
      phaseIndex: 0,
      phaseName: "구현",
      success: true,
      durationMs: 500,
      warnings: ["미사용 변수 발견", "타입 단언 사용됨"],
    };
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings?.[0]).toBe("미사용 변수 발견");
  });

  it("errors 필드에 에러 메시지 목록을 담을 수 있다", () => {
    const result: PhaseResult = {
      phaseIndex: 1,
      phaseName: "검증",
      success: false,
      durationMs: 300,
      error: "검증 실패",
      errors: ["테스트 실패: foo.test.ts", "타입 에러: bar.ts:10"],
    };
    expect(result.errors).toHaveLength(2);
    expect(result.errors?.[1]).toBe("타입 에러: bar.ts:10");
  });

  it("partial 필드로 부분 성공 상태를 표현할 수 있다", () => {
    const result: PhaseResult = {
      phaseIndex: 2,
      phaseName: "테스트",
      success: false,
      durationMs: 800,
      partial: true,
      warnings: ["일부 테스트 스킵됨"],
      errors: ["테스트 3개 실패"],
    };
    expect(result.partial).toBe(true);
    expect(result.success).toBe(false);
  });

  it("warnings, errors, partial 모두 optional이다", () => {
    const result: PhaseResult = {
      phaseIndex: 0,
      phaseName: "구현",
      success: true,
      durationMs: 100,
    };
    // TypeScript 컴파일이 통과하면 optional 확인됨
    expect(result).not.toHaveProperty("warnings");
    expect(result).not.toHaveProperty("errors");
    expect(result).not.toHaveProperty("partial");
  });

  it("빈 배열도 유효한 warnings/errors 값이다", () => {
    const result: PhaseResult = {
      phaseIndex: 0,
      phaseName: "구현",
      success: true,
      durationMs: 200,
      warnings: [],
      errors: [],
    };
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
