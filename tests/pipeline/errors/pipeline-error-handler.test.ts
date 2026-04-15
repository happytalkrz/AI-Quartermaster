import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CoreLoopFailureContext, GeneralPipelineFailureContext } from "../../../src/pipeline/errors/pipeline-error-handler.js";
import type { CoreLoopResult } from "../../../src/pipeline/core/core-loop.js";
import type { PipelineRuntime } from "../../../src/pipeline/core/pipeline-context.js";
import type { AQConfig, GitConfig } from "../../../src/types/config.js";
import type { UserSummary } from "../../../src/types/pipeline.js";

vi.mock("../../../src/pipeline/reporting/result-reporter.js", () => ({
  formatResult: vi.fn().mockReturnValue({ issueNumber: 1, phases: [] }),
  printResult: vi.fn(),
}));

vi.mock("../../../src/safety/rollback-manager.js", () => ({
  rollbackToCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/pipeline/core/pipeline-context.js", () => ({
  saveResult: vi.fn(),
  transitionState: vi.fn(),
}));

vi.mock("../../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../src/utils/error-utils.js", () => ({
  getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  isAQMError: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../src/pipeline/phases/pipeline-publish.js", () => ({
  handlePipelineFailure: vi.fn().mockResolvedValue("Phase execution failed"),
}));

vi.mock("../../../src/pipeline/errors/diagnosis-runner.js", () => ({
  runDiagnosis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/pipeline/errors/error-classifier.js", () => ({
  classifyError: vi.fn().mockReturnValue("UNKNOWN"),
}));

vi.mock("../../../src/pipeline/errors/user-message-table.js", () => ({
  getUserSummary: vi.fn().mockReturnValue({
    what: "알 수 없는 오류로 작업이 실패했습니다.",
    why: "예상치 못한 문제가 발생했습니다.",
    next: "관리자에게 실패 로그와 함께 문의해 주세요.",
  } satisfies UserSummary),
}));

function makeGitConfig(): GitConfig {
  return { gitPath: "git" };
}

function makeAQConfig(): AQConfig {
  return {
    worktree: { cleanupOnFailure: false },
    commands: {},
  } as unknown as AQConfig;
}

function makeCoreLoopResult(overrides: Partial<CoreLoopResult> = {}): CoreLoopResult {
  return {
    success: false,
    plan: {
      issueNumber: 42,
      title: "feat: test",
      problemDefinition: "def",
      requirements: [],
      affectedFiles: [],
      risks: [],
      phases: [],
      verificationPoints: [],
      stopConditions: [],
    },
    phaseResults: [],
    totalCostUsd: 0,
    ...overrides,
  };
}

function makeCoreLoopFailureContext(overrides: Partial<CoreLoopFailureContext> = {}): CoreLoopFailureContext {
  return {
    issueNumber: 42,
    repo: "owner/repo",
    coreResult: makeCoreLoopResult(),
    rollbackStrategy: "none",
    gitConfig: makeGitConfig(),
    startTime: Date.now(),
    config: makeAQConfig(),
    aqRoot: "/aq",
    projectRoot: "/project",
    dataDir: "/data",
    patternStore: { add: vi.fn() } as unknown as import("../../../src/learning/pattern-store.js").PatternStore,
    checkpoint: vi.fn(),
    ...overrides,
  };
}

function makePipelineRuntime(): PipelineRuntime {
  return {
    state: "FAILED",
    projectRoot: "/project",
    gitConfig: makeGitConfig(),
    promptsDir: "/aq/prompts",
    rollbackStrategy: "none",
  };
}

describe("handleCoreLoopFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("userSummary 주입", () => {
    it("결과에 userSummary 필드가 포함된다", async () => {
      const { handleCoreLoopFailure } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const result = await handleCoreLoopFailure(makeCoreLoopFailureContext());

      expect(result.userSummary).toBeDefined();
      expect(result.userSummary?.what).toBeTruthy();
      expect(result.userSummary?.why).toBeTruthy();
      expect(result.userSummary?.next).toBeTruthy();
    });

    it("failedPhase의 errorCategory로 getUserSummary를 호출한다", async () => {
      const { getUserSummary } = await import("../../../src/pipeline/errors/user-message-table.js");
      const { handleCoreLoopFailure } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const coreResult = makeCoreLoopResult({
        phaseResults: [
          {
            phaseIndex: 0,
            phaseName: "build",
            success: false,
            error: "TS2345 type error",
            errorCategory: "TS_ERROR",
            durationMs: 1000,
          },
        ],
      });

      await handleCoreLoopFailure(makeCoreLoopFailureContext({ coreResult }));

      expect(getUserSummary).toHaveBeenCalledWith("TS_ERROR");
    });

    it("failedPhase가 없으면 classifyError 결과로 getUserSummary를 호출한다", async () => {
      const { getUserSummary } = await import("../../../src/pipeline/errors/user-message-table.js");
      const { classifyError } = await import("../../../src/pipeline/errors/error-classifier.js");
      const { handleCoreLoopFailure } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      vi.mocked(classifyError).mockReturnValue("TIMEOUT");

      await handleCoreLoopFailure(makeCoreLoopFailureContext());

      expect(getUserSummary).toHaveBeenCalledWith("TIMEOUT");
    });

    it("success는 항상 false이다", async () => {
      const { handleCoreLoopFailure } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const result = await handleCoreLoopFailure(makeCoreLoopFailureContext());

      expect(result.success).toBe(false);
    });

    it("state는 FAILED이다", async () => {
      const { handleCoreLoopFailure } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const result = await handleCoreLoopFailure(makeCoreLoopFailureContext());

      expect(result.state).toBe("FAILED");
    });
  });

  describe("각 ErrorCategory별 userSummary 전파", () => {
    const categories = [
      "TS_ERROR",
      "TIMEOUT",
      "VERIFICATION_FAILED",
      "RATE_LIMIT",
      "QUOTA_EXHAUSTED",
    ] as const;

    it.each(categories)("%s 카테고리의 userSummary가 결과에 포함된다", async (category) => {
      const { getUserSummary } = await import("../../../src/pipeline/errors/user-message-table.js");
      const { handleCoreLoopFailure } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const mockSummary: UserSummary = {
        what: `${category} what`,
        why: `${category} why`,
        next: `${category} next`,
      };
      vi.mocked(getUserSummary).mockReturnValue(mockSummary);

      const coreResult = makeCoreLoopResult({
        phaseResults: [
          {
            phaseIndex: 0,
            phaseName: "phase",
            success: false,
            error: "error",
            errorCategory: category,
            durationMs: 100,
          },
        ],
      });

      const result = await handleCoreLoopFailure(makeCoreLoopFailureContext({ coreResult }));

      expect(result.userSummary).toEqual(mockSummary);
    });
  });
});

describe("handleGeneralPipelineError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeContext(errorOverride: unknown = new Error("pipeline error")): GeneralPipelineFailureContext {
    return {
      error: errorOverride,
      runtime: makePipelineRuntime(),
      input: { issueNumber: 42, repo: "owner/repo" },
      config: makeAQConfig(),
      startTime: Date.now(),
    };
  }

  describe("userSummary 주입", () => {
    it("결과에 userSummary 필드가 포함된다", async () => {
      const { handleGeneralPipelineError } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const result = await handleGeneralPipelineError(makeContext());

      expect(result.userSummary).toBeDefined();
      expect(result.userSummary?.what).toBeTruthy();
    });

    it("classifyError 결과로 getUserSummary를 호출한다", async () => {
      const { getUserSummary } = await import("../../../src/pipeline/errors/user-message-table.js");
      const { classifyError } = await import("../../../src/pipeline/errors/error-classifier.js");
      const { handleGeneralPipelineError } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      vi.mocked(classifyError).mockReturnValue("CLI_CRASH");

      await handleGeneralPipelineError(makeContext(new Error("spawn failed")));

      expect(getUserSummary).toHaveBeenCalledWith("CLI_CRASH");
    });

    it("getUserSummary 반환값이 result.userSummary로 전달된다", async () => {
      const { getUserSummary } = await import("../../../src/pipeline/errors/user-message-table.js");
      const { handleGeneralPipelineError } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const mockSummary: UserSummary = {
        what: "내부 도구가 예상치 못하게 종료됐습니다.",
        why: "Claude CLI가 비정상 종료되었습니다.",
        next: "관리자에게 문의해 주세요.",
      };
      vi.mocked(getUserSummary).mockReturnValue(mockSummary);

      const result = await handleGeneralPipelineError(makeContext());

      expect(result.userSummary).toEqual(mockSummary);
    });

    it("success는 항상 false이다", async () => {
      const { handleGeneralPipelineError } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const result = await handleGeneralPipelineError(makeContext());

      expect(result.success).toBe(false);
    });

    it("state는 FAILED이다", async () => {
      const { handleGeneralPipelineError } = await import("../../../src/pipeline/errors/pipeline-error-handler.js");

      const result = await handleGeneralPipelineError(makeContext());

      expect(result.state).toBe("FAILED");
    });
  });
});
