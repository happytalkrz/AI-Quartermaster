import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiagnosisRunnerOptions } from "../../../src/pipeline/errors/diagnosis-runner.js";
import type { ClaudeCliConfig } from "../../../src/types/config.js";

vi.mock("../../../src/pipeline/errors/error-context-collector.js", () => ({
  collectErrorContext: vi.fn().mockReturnValue({
    issue: { number: "42", title: "feat: test" },
    repo: "owner/repo",
    state: "FAILED",
    errorCategory: "UNKNOWN",
    errorMessage: "Test error",
    phase: { index: "0", name: "compile", description: "", targetFiles: "" },
    recentLogs: "(로그 없음)",
    errorHistory: "(이력 없음)",
  }),
}));

vi.mock("../../../src/prompt/template-renderer.js", () => ({
  loadTemplate: vi.fn().mockReturnValue("template content"),
  renderTemplate: vi.fn().mockReturnValue("rendered prompt"),
}));

vi.mock("../../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const VALID_DIAGNOSIS_JSON = JSON.stringify({
  rootCause: "TypeScript 타입 불일치로 인한 컴파일 오류",
  recommendedActions: ["타입 정의 확인", "import 경로 검증"],
  canAutoRetry: false,
  retryStrategy: null,
  errorCategory: "TS_ERROR",
  confidence: "high",
});

function makeOptions(overrides: Partial<DiagnosisRunnerOptions> = {}): DiagnosisRunnerOptions {
  const claudeConfig: ClaudeCliConfig = {
    path: "claude",
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
  };
  return {
    input: {
      issueNumber: 42,
      issueTitle: "feat: test",
      repo: "owner/repo",
      state: "FAILED",
      recentLogs: [],
      errorHistory: [],
    },
    claudeConfig,
    promptsDir: "/prompts",
    cwd: "/workspace",
    ...overrides,
  };
}

describe("runDiagnosis", () => {
  let runClaude: ReturnType<typeof vi.fn>;
  let extractJson: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const runner = await import("../../../src/claude/claude-runner.js");
    runClaude = runner.runClaude as ReturnType<typeof vi.fn>;
    extractJson = runner.extractJson as ReturnType<typeof vi.fn>;
  });

  describe("정상 경로", () => {
    it("유효한 JSON 응답으로 DiagnosisReport를 반환한다", async () => {
      runClaude.mockResolvedValue({ success: true, output: VALID_DIAGNOSIS_JSON });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeDefined();
      expect(result?.rootCause).toBe("TypeScript 타입 불일치로 인한 컴파일 오류");
      expect(result?.recommendedActions).toEqual(["타입 정의 확인", "import 경로 검증"]);
      expect(result?.canAutoRetry).toBe(false);
      expect(result?.errorCategory).toBe("TS_ERROR");
      expect(result?.confidence).toBe("high");
      expect(result?.generatedAt).toBeDefined();
    });

    it("generatedAt이 ISO 8601 형식이다", async () => {
      runClaude.mockResolvedValue({ success: true, output: VALID_DIAGNOSIS_JSON });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("haiku 모델로 Claude를 호출한다", async () => {
      runClaude.mockResolvedValue({ success: true, output: VALID_DIAGNOSIS_JSON });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      await runDiagnosis(makeOptions());

      expect(runClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            model: "claude-haiku-4-5-20251001",
          }),
        })
      );
    });

    it("maxTurns: 1로 Claude를 호출한다", async () => {
      runClaude.mockResolvedValue({ success: true, output: VALID_DIAGNOSIS_JSON });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      await runDiagnosis(makeOptions());

      expect(runClaude).toHaveBeenCalledWith(
        expect.objectContaining({ maxTurns: 1 })
      );
    });

    it("retryStrategy가 null이면 undefined로 변환한다", async () => {
      runClaude.mockResolvedValue({ success: true, output: VALID_DIAGNOSIS_JSON });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result?.retryStrategy).toBeUndefined();
    });

    it("retryStrategy가 있으면 포함된다", async () => {
      const jsonWithRetry = JSON.stringify({
        rootCause: "Rate limit exceeded",
        recommendedActions: ["잠시 후 재시도"],
        canAutoRetry: true,
        retryStrategy: "30초 후 자동 재시도",
        errorCategory: "RATE_LIMIT",
        confidence: "medium",
      });
      runClaude.mockResolvedValue({ success: true, output: jsonWithRetry });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result?.retryStrategy).toBe("30초 후 자동 재시도");
      expect(result?.canAutoRetry).toBe(true);
    });
  });

  describe("Claude 호출 실패", () => {
    it("success: false이면 undefined를 반환한다", async () => {
      runClaude.mockResolvedValue({ success: false, output: "Claude error output" });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeUndefined();
    });

    it("runClaude가 예외를 던지면 undefined를 반환한다", async () => {
      runClaude.mockRejectedValue(new Error("Claude CLI not found"));

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeUndefined();
    });
  });

  describe("JSON 파싱 실패", () => {
    it("잘못된 JSON 응답 시 extractJson으로 폴백한다", async () => {
      const wrappedOutput = `Here is the diagnosis:\n${VALID_DIAGNOSIS_JSON}\nEnd of diagnosis`;
      runClaude.mockResolvedValue({ success: true, output: wrappedOutput });
      extractJson.mockReturnValue(JSON.parse(VALID_DIAGNOSIS_JSON));

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeDefined();
      expect(result?.rootCause).toBe("TypeScript 타입 불일치로 인한 컴파일 오류");
    });

    it("extractJson도 실패하면 undefined를 반환한다", async () => {
      runClaude.mockResolvedValue({ success: true, output: "not valid json at all" });
      extractJson.mockImplementation(() => {
        throw new Error("No JSON found");
      });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeUndefined();
    });

    it("Zod 스키마 검증 실패 시 undefined를 반환한다", async () => {
      const invalidSchema = JSON.stringify({
        rootCause: "error",
        // recommendedActions 누락
        canAutoRetry: false,
        errorCategory: "UNKNOWN",
        confidence: "high",
      });
      runClaude.mockResolvedValue({ success: true, output: invalidSchema });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeUndefined();
    });

    it("유효하지 않은 errorCategory 값 시 undefined를 반환한다", async () => {
      const invalidCategory = JSON.stringify({
        rootCause: "error",
        recommendedActions: ["fix it"],
        canAutoRetry: false,
        errorCategory: "INVALID_CATEGORY",
        confidence: "high",
      });
      runClaude.mockResolvedValue({ success: true, output: invalidCategory });

      const { runDiagnosis } = await import("../../../src/pipeline/errors/diagnosis-runner.js");
      const result = await runDiagnosis(makeOptions());

      expect(result).toBeUndefined();
    });
  });
});
