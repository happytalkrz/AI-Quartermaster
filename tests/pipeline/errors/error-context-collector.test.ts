import { describe, it, expect } from "vitest";
import { collectErrorContext } from "../../../src/pipeline/errors/error-context-collector.js";
import type { DiagnosisInput } from "../../../src/pipeline/errors/error-context-collector.js";
import type { PhaseResult, Plan, ErrorHistoryEntry } from "../../../src/types/pipeline.js";

function makeInput(overrides: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    issueNumber: 42,
    issueTitle: "feat: add new feature",
    repo: "owner/repo",
    state: "FAILED",
    recentLogs: [],
    errorHistory: [],
    ...overrides,
  };
}

describe("collectErrorContext", () => {
  describe("기본 필드 매핑", () => {
    it("issueNumber, issueTitle, repo, state를 올바르게 매핑한다", () => {
      const result = collectErrorContext(makeInput());

      expect(result.issue).toEqual({ number: "42", title: "feat: add new feature" });
      expect(result.repo).toBe("owner/repo");
      expect(result.state).toBe("FAILED");
    });
  });

  describe("failedPhase가 없는 경우", () => {
    it("에러 메시지가 Unknown error로 설정된다", () => {
      const result = collectErrorContext(makeInput({ failedPhase: undefined }));

      expect(result.errorMessage).toBe("Unknown error");
    });

    it("phaseIndex가 -1, phaseName이 Unknown으로 설정된다", () => {
      const result = collectErrorContext(makeInput({ failedPhase: undefined }));

      expect(result.phase).toMatchObject({ index: "-1", name: "Unknown" });
    });

    it("errorCategory가 UNKNOWN으로 설정된다", () => {
      const result = collectErrorContext(makeInput({ failedPhase: undefined }));

      expect(result.errorCategory).toBe("UNKNOWN");
    });
  });

  describe("failedPhase가 있는 경우", () => {
    it("error 메시지를 사용한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 1,
        phaseName: "compile",
        success: false,
        error: "TS2345: Argument of type string is not assignable",
        durationMs: 1000,
      };
      const result = collectErrorContext(makeInput({ failedPhase }));

      expect(result.errorMessage).toBe("TS2345: Argument of type string is not assignable");
    });

    it("error가 없으면 lastOutput을 폴백으로 사용한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 1,
        phaseName: "compile",
        success: false,
        lastOutput: "Process exited with code 1",
        durationMs: 1000,
      };
      const result = collectErrorContext(makeInput({ failedPhase }));

      expect(result.errorMessage).toBe("Process exited with code 1");
    });

    it("PhaseResult의 errorCategory를 우선 사용한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 0,
        phaseName: "test",
        success: false,
        error: "Tests failed",
        errorCategory: "VERIFICATION_FAILED",
        durationMs: 500,
      };
      const result = collectErrorContext(makeInput({ failedPhase }));

      expect(result.errorCategory).toBe("VERIFICATION_FAILED");
    });

    it("errorCategory가 없으면 classifyError로 자동 분류한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 0,
        phaseName: "build",
        success: false,
        error: "error TS2304: Cannot find name 'foo'",
        durationMs: 500,
      };
      const result = collectErrorContext(makeInput({ failedPhase }));

      expect(result.errorCategory).toBe("TS_ERROR");
    });

    it("phaseIndex와 phaseName을 올바르게 매핑한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 3,
        phaseName: "verify",
        success: false,
        error: "lint error",
        durationMs: 200,
      };
      const result = collectErrorContext(makeInput({ failedPhase }));

      expect(result.phase).toMatchObject({ index: "3", name: "verify" });
    });
  });

  describe("Plan에서 phase 상세 정보 조회", () => {
    it("plan의 phase에서 description과 targetFiles를 조회한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 1,
        phaseName: "implement",
        success: false,
        error: "error",
        durationMs: 100,
      };
      const plan: Plan = {
        issueNumber: 42,
        title: "feat",
        problemDefinition: "def",
        requirements: [],
        affectedFiles: [],
        risks: [],
        phases: [
          {
            index: 1,
            name: "implement",
            description: "핵심 로직 구현",
            targetFiles: ["src/foo.ts", "src/bar.ts"],
            commitStrategy: "단일 커밋",
            verificationCriteria: [],
          },
        ],
        verificationPoints: [],
        stopConditions: [],
      };
      const result = collectErrorContext(makeInput({ failedPhase, plan }));

      expect(result.phase).toMatchObject({
        description: "핵심 로직 구현",
        targetFiles: "src/foo.ts, src/bar.ts",
      });
    });

    it("plan에 해당 phase가 없으면 빈 문자열로 설정한다", () => {
      const failedPhase: PhaseResult = {
        phaseIndex: 99,
        phaseName: "unknown-phase",
        success: false,
        error: "error",
        durationMs: 100,
      };
      const plan: Plan = {
        issueNumber: 42,
        title: "feat",
        problemDefinition: "def",
        requirements: [],
        affectedFiles: [],
        risks: [],
        phases: [],
        verificationPoints: [],
        stopConditions: [],
      };
      const result = collectErrorContext(makeInput({ failedPhase, plan }));

      expect(result.phase).toMatchObject({ description: "", targetFiles: "" });
    });
  });

  describe("크기 제한", () => {
    it("500자 초과 에러 메시지는 잘린다", () => {
      const longError = "E".repeat(600);
      const failedPhase: PhaseResult = {
        phaseIndex: 0,
        phaseName: "phase",
        success: false,
        error: longError,
        durationMs: 100,
      };
      const result = collectErrorContext(makeInput({ failedPhase }));

      expect((result.errorMessage as string).length).toBeLessThanOrEqual(500);
      expect(result.errorMessage as string).toMatch(/\.\.\.$/);
    });

    it("3000자 초과 로그는 잘린다", () => {
      const recentLogs = Array.from({ length: 200 }, (_, i) => `log line ${i}: ${"x".repeat(30)}`);
      const result = collectErrorContext(makeInput({ recentLogs }));

      expect((result.recentLogs as string).length).toBeLessThanOrEqual(3100); // 약간의 마진
    });

    it("500자 초과 에러 히스토리는 잘린다", () => {
      const errorHistory: ErrorHistoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
        attempt: i + 1,
        errorCategory: "UNKNOWN" as const,
        errorMessage: `Error message for attempt ${i + 1}: ${"detail".repeat(10)}`,
        timestamp: "2026-04-12T00:00:00Z",
      }));
      const result = collectErrorContext(makeInput({ errorHistory }));

      expect((result.errorHistory as string).length).toBeLessThanOrEqual(600); // 약간의 마진
    });
  });

  describe("recentLogs 포매팅", () => {
    it("빈 로그는 (로그 없음)을 반환한다", () => {
      const result = collectErrorContext(makeInput({ recentLogs: [] }));

      expect(result.recentLogs).toBe("(로그 없음)");
    });

    it("로그 라인을 줄바꿈으로 조합한다", () => {
      const recentLogs = ["line1", "line2", "line3"];
      const result = collectErrorContext(makeInput({ recentLogs }));

      expect(result.recentLogs).toBe("line1\nline2\nline3");
    });

    it("100줄 초과 시 마지막 100줄만 사용한다", () => {
      const recentLogs = Array.from({ length: 150 }, (_, i) => `line-${i}`);
      const result = collectErrorContext(makeInput({ recentLogs }));
      const logsText = result.recentLogs as string;

      expect(logsText).toContain("line-149");
      expect(logsText).not.toContain("line-0");
    });
  });

  describe("errorHistory 포매팅", () => {
    it("빈 히스토리는 (이력 없음)을 반환한다", () => {
      const result = collectErrorContext(makeInput({ errorHistory: [] }));

      expect(result.errorHistory).toBe("(이력 없음)");
    });

    it("히스토리 항목을 포매팅한다", () => {
      const errorHistory: ErrorHistoryEntry[] = [
        {
          attempt: 1,
          errorCategory: "TS_ERROR",
          errorMessage: "Type error occurred",
          timestamp: "2026-04-12T01:00:00Z",
        },
      ];
      const result = collectErrorContext(makeInput({ errorHistory }));

      expect(result.errorHistory as string).toContain("[시도 1]");
      expect(result.errorHistory as string).toContain("TS_ERROR");
      expect(result.errorHistory as string).toContain("Type error occurred");
    });

    it("최신 항목이 포함된다", () => {
      const errorHistory: ErrorHistoryEntry[] = [
        { attempt: 1, errorCategory: "TIMEOUT", errorMessage: "first error", timestamp: "2026-04-12T01:00:00Z" },
        { attempt: 2, errorCategory: "TS_ERROR", errorMessage: "second error", timestamp: "2026-04-12T01:01:00Z" },
      ];
      const result = collectErrorContext(makeInput({ errorHistory }));

      expect(result.errorHistory as string).toContain("[시도 2]");
    });
  });
});
