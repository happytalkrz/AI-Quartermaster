import { describe, it, expect } from "vitest";
import { getUserSummary } from "../../../src/pipeline/errors/user-message-table.js";
import type { ErrorCategory } from "../../../src/types/pipeline.js";

const ALL_CATEGORIES: ErrorCategory[] = [
  "TS_ERROR",
  "TIMEOUT",
  "CLI_CRASH",
  "VERIFICATION_FAILED",
  "SAFETY_VIOLATION",
  "RATE_LIMIT",
  "PROMPT_TOO_LONG",
  "MAX_TURNS_EXCEEDED",
  "QUOTA_EXHAUSTED",
  "UNKNOWN",
];

describe("getUserSummary", () => {
  describe("매핑 테이블 완전성", () => {
    it.each(ALL_CATEGORIES)("%s 카테고리에 대한 UserSummary가 존재한다", (category) => {
      const result = getUserSummary(category);

      expect(result).toBeDefined();
      expect(result.what).toBeTruthy();
      expect(result.why).toBeTruthy();
      expect(result.next).toBeTruthy();
    });

    it.each(ALL_CATEGORIES)("%s 카테고리의 what/why/next는 비어있지 않은 문자열이다", (category) => {
      const result = getUserSummary(category);

      expect(typeof result.what).toBe("string");
      expect(typeof result.why).toBe("string");
      expect(typeof result.next).toBe("string");
      expect(result.what.length).toBeGreaterThan(0);
      expect(result.why.length).toBeGreaterThan(0);
      expect(result.next.length).toBeGreaterThan(0);
    });
  });

  describe("개별 카테고리 메시지 검증", () => {
    it("TS_ERROR는 타입 오류 관련 메시지를 반환한다", () => {
      const result = getUserSummary("TS_ERROR");

      expect(result.what).toContain("타입");
    });

    it("TIMEOUT은 시간 초과 관련 메시지를 반환한다", () => {
      const result = getUserSummary("TIMEOUT");

      expect(result.what).toContain("시간");
    });

    it("RATE_LIMIT은 요청 한도 관련 메시지를 반환한다", () => {
      const result = getUserSummary("RATE_LIMIT");

      expect(result.what).toContain("한도");
    });

    it("QUOTA_EXHAUSTED는 사용 한도 소진 관련 메시지를 반환한다", () => {
      const result = getUserSummary("QUOTA_EXHAUSTED");

      expect(result.what).toContain("한도");
    });

    it("MAX_TURNS_EXCEEDED는 대화 횟수 관련 메시지를 반환한다", () => {
      const result = getUserSummary("MAX_TURNS_EXCEEDED");

      expect(result.what).toContain("대화 횟수");
    });

    it("SAFETY_VIOLATION은 안전 정책 관련 메시지를 반환한다", () => {
      const result = getUserSummary("SAFETY_VIOLATION");

      expect(result.what).toContain("안전");
    });

    it("VERIFICATION_FAILED는 검증 실패 관련 메시지를 반환한다", () => {
      const result = getUserSummary("VERIFICATION_FAILED");

      expect(result.what).toContain("검증");
    });

    it("PROMPT_TOO_LONG은 요청 길이 관련 메시지를 반환한다", () => {
      const result = getUserSummary("PROMPT_TOO_LONG");

      expect(result.what).toContain("길어");
    });

    it("CLI_CRASH는 내부 도구 관련 메시지를 반환한다", () => {
      const result = getUserSummary("CLI_CRASH");

      expect(result.what).toContain("도구");
    });

    it("UNKNOWN은 알 수 없는 오류 메시지를 반환한다", () => {
      const result = getUserSummary("UNKNOWN");

      expect(result.what).toContain("알 수 없는");
    });
  });

  describe("fallback 동작", () => {
    it("매핑 테이블에 없는 카테고리는 fallback UserSummary를 반환한다", () => {
      // 타입 강제 캐스팅으로 미등록 카테고리 시뮬레이션
      const result = getUserSummary("NONEXISTENT_CATEGORY" as ErrorCategory);

      expect(result).toBeDefined();
      expect(result.what).toContain("알 수 없는");
      expect(result.why).toBeTruthy();
      expect(result.next).toBeTruthy();
    });

    it("fallback 메시지는 UNKNOWN 카테고리 메시지와 동일하다", () => {
      const unknown = getUserSummary("UNKNOWN");
      const fallback = getUserSummary("NONEXISTENT_CATEGORY" as ErrorCategory);

      expect(fallback.what).toBe(unknown.what);
      expect(fallback.why).toBe(unknown.why);
      expect(fallback.next).toBe(unknown.next);
    });
  });
});
