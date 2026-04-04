import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("../../src/pipeline/final-validator.js", () => ({
  runFinalValidation: vi.fn(),
}));
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../src/claude/model-router.js", () => ({
  configForTask: vi.fn(),
  configForTaskWithMode: vi.fn(),
}));
vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
}));
vi.mock("../../src/pipeline/result-reporter.js", () => ({
  formatResult: vi.fn(),
  printResult: vi.fn(),
}));
vi.mock("../../src/pipeline/progress-tracker.js", () => ({
  PROGRESS_VALIDATION_START: 85,
}));
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock("path", () => ({
  resolve: vi.fn((a: string, b: string) => `${a}/${b}`),
}));

import { runValidationPhase } from "../../src/pipeline/pipeline-validation.js";
import { runFinalValidation } from "../../src/pipeline/final-validator.js";
import { runClaude } from "../../src/claude/claude-runner.js";
import { configForTask, configForTaskWithMode } from "../../src/claude/model-router.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";
import { formatResult, printResult } from "../../src/pipeline/result-reporter.js";
import type { ValidationPhaseContext } from "../../src/types/pipeline.js";
import type { ExecutionMode } from "../../src/types/config.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

const mockRunFinalValidation = vi.mocked(runFinalValidation);
const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTask = vi.mocked(configForTask);
const mockConfigForTaskWithMode = vi.mocked(configForTaskWithMode);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockFormatResult = vi.mocked(formatResult);
const mockPrintResult = vi.mocked(printResult);

function makeValidationContext(): ValidationPhaseContext {
  return {
    commands: {
      claudeCli: { path: "claude", model: "haiku" },
    },
    cwd: "/tmp/project",
    gitPath: "git",
    maxRetries: 2,
    plan: {
      issueNumber: 42,
      title: "Test Issue",
      problemDefinition: "Test problem",
      requirements: ["Fix bug"],
      affectedFiles: ["src/test.ts"],
      risks: [],
      phases: [{
        index: 0,
        name: "Fix",
        description: "Fix it",
        targetFiles: ["src/test.ts"],
        commitStrategy: "atomic",
        verificationCriteria: ["tests pass"],
        dependsOn: []
      }],
      verificationPoints: [],
      stopConditions: [],
    },
    phaseResults: [{
      phaseIndex: 0,
      phaseName: "Fix",
      success: true,
      commitHash: "abc123",
      durationMs: 1000
    }],
    jl: {
      setStep: vi.fn(),
      setProgress: vi.fn(),
      log: vi.fn(),
    },
  };
}

function makeTimer() {
  return {
    assertNotExpired: vi.fn(),
  };
}

function makeFullCommands() {
  return {
    build: { command: "npm run build" },
    test: { command: "npm test" },
    lint: { command: "npm run lint" },
  };
}

describe("runValidationPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigForTask.mockReturnValue({ path: "claude", model: "haiku" });
    mockConfigForTaskWithMode.mockReturnValue({ path: "claude", model: "haiku" });
    mockAutoCommitIfDirty.mockResolvedValue(undefined);
    mockFormatResult.mockReturnValue({} as any);
    mockPrintResult.mockReturnValue(undefined);
  });

  it("should skip validation when skipFinalValidation is true", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(false);
    const checkpoint = vi.fn();

    const result = await runValidationPhase(
      context,
      timer as any,
      isPastState,
      true, // skipFinalValidation
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(result.success).toBe(true);
    expect(mockRunFinalValidation).not.toHaveBeenCalled();
  });

  it("should skip validation when already past FINAL_VALIDATING state", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(true);
    const checkpoint = vi.fn();

    const result = await runValidationPhase(
      context,
      timer as any,
      isPastState,
      false,
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(result.success).toBe(true);
    expect(isPastState).toHaveBeenCalledWith("FINAL_VALIDATING");
    expect(mockRunFinalValidation).not.toHaveBeenCalled();
  });

  it("should succeed when validation passes", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(false);
    const checkpoint = vi.fn();

    mockRunFinalValidation.mockResolvedValue({
      success: true,
      checks: [
        { name: "build", passed: true },
        { name: "test", passed: true },
        { name: "lint", passed: true },
      ],
    });

    const result = await runValidationPhase(
      context,
      timer as any,
      isPastState,
      false,
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(result.success).toBe(true);
    expect(mockRunFinalValidation).toHaveBeenCalledWith(
      makeFullCommands(),
      { cwd: "/tmp/project" },
      "standard",
      "git"
    );
    expect(checkpoint).toHaveBeenCalled();
    expect(context.jl?.log).toHaveBeenCalledWith("PASS build");
    expect(context.jl?.log).toHaveBeenCalledWith("PASS test");
    expect(context.jl?.log).toHaveBeenCalledWith("PASS lint");
  });

  it("should retry and succeed when validation fails initially", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(false);
    const checkpoint = vi.fn();

    // First validation fails
    mockRunFinalValidation
      .mockResolvedValueOnce({
        success: false,
        checks: [
          { name: "build", passed: true },
          { name: "test", passed: false, output: "Test failed: missing assertion" },
          { name: "lint", passed: true },
        ],
      })
      // Second validation (after fix) passes
      .mockResolvedValueOnce({
        success: true,
        checks: [
          { name: "build", passed: true },
          { name: "test", passed: true },
          { name: "lint", passed: true },
        ],
      });

    const result = await runValidationPhase(
      context,
      timer as any,
      isPastState,
      false,
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(result.success).toBe(true);
    expect(mockRunFinalValidation).toHaveBeenCalledTimes(2);
    expect(mockRunClaude).toHaveBeenCalledWith({
      prompt: expect.stringContaining("test"),
      cwd: "/tmp/project",
      config: { path: "claude", model: "haiku" },
    });
    expect(mockAutoCommitIfDirty).toHaveBeenCalledWith(
      "git",
      "/tmp/project",
      "fix: validation 오류 수정 (retry 1)"
    );
  });

  it("should fail after exhausting max retries", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(false);
    const checkpoint = vi.fn();

    // All validations fail
    mockRunFinalValidation.mockResolvedValue({
      success: false,
      checks: [
        { name: "build", passed: false, output: "Build error: syntax error" },
        { name: "test", passed: false, output: "Test failed: timeout" },
      ],
    });

    const result = await runValidationPhase(
      context,
      timer as any,
      isPastState,
      false,
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Final validation failed after 2 retries");
    expect(result.error).toContain("build, test");
    expect(mockRunFinalValidation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(mockRunClaude).toHaveBeenCalledTimes(2); // 2 retry attempts
  });

  it("should call timer.assertNotExpired", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(false);
    const checkpoint = vi.fn();

    mockRunFinalValidation.mockResolvedValue({
      success: true,
      checks: [{ name: "test", passed: true }],
    });

    await runValidationPhase(
      context,
      timer as any,
      isPastState,
      false,
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(timer.assertNotExpired).toHaveBeenCalledWith("final-validation");
  });

  it("should update progress and step during validation", async () => {
    const context = makeValidationContext();
    const timer = makeTimer();
    const isPastState = vi.fn().mockReturnValue(false);
    const checkpoint = vi.fn();

    mockRunFinalValidation.mockResolvedValue({
      success: true,
      checks: [{ name: "test", passed: true }],
    });

    await runValidationPhase(
      context,
      timer as any,
      isPastState,
      false,
      "standard" as ExecutionMode,
      checkpoint,
      42,
      "test/repo",
      Date.now(),
      DEFAULT_CONFIG,
      makeFullCommands(),
      "/tmp/aq",
      "/tmp/project"
    );

    expect(context.jl?.setStep).toHaveBeenCalledWith("최종 검증 중...");
    expect(context.jl?.setProgress).toHaveBeenCalledWith(85);
  });

  describe("execution mode integration", () => {
    it("should run validation in economy mode when enableFinalValidation is true", async () => {
      const context = makeValidationContext();
      const timer = makeTimer();
      const isPastState = vi.fn().mockReturnValue(false);
      const checkpoint = vi.fn();

      mockRunFinalValidation.mockResolvedValue({
        success: true,
        checks: [{ name: "test", passed: true }],
      });

      const result = await runValidationPhase(
        context,
        timer as any,
        isPastState,
        false, // enableFinalValidation = true (economy can still validate if explicitly enabled)
        "economy" as ExecutionMode,
        checkpoint,
        42,
        "test/repo",
        Date.now(),
        DEFAULT_CONFIG,
        makeFullCommands(),
        "/tmp/aq",
        "/tmp/project"
      );

      expect(result.success).toBe(true);
      expect(mockRunFinalValidation).toHaveBeenCalledWith(
        makeFullCommands(),
        { cwd: "/tmp/project" },
        "economy",
        "git"
      );
    });

    it("should run validation in standard mode", async () => {
      const context = makeValidationContext();
      const timer = makeTimer();
      const isPastState = vi.fn().mockReturnValue(false);
      const checkpoint = vi.fn();

      mockRunFinalValidation.mockResolvedValue({
        success: true,
        checks: [
          { name: "build", passed: true },
          { name: "test", passed: true },
          { name: "lint", passed: true },
        ],
      });

      const result = await runValidationPhase(
        context,
        timer as any,
        isPastState,
        false,
        "standard" as ExecutionMode,
        checkpoint,
        42,
        "test/repo",
        Date.now(),
        DEFAULT_CONFIG,
        makeFullCommands(),
        "/tmp/aq",
        "/tmp/project"
      );

      expect(result.success).toBe(true);
      expect(mockRunFinalValidation).toHaveBeenCalledWith(
        makeFullCommands(),
        { cwd: "/tmp/project" },
        "standard",
        "git"
      );
    });

    it("should run validation in thorough mode with comprehensive checks", async () => {
      const context = makeValidationContext();
      const timer = makeTimer();
      const isPastState = vi.fn().mockReturnValue(false);
      const checkpoint = vi.fn();

      mockRunFinalValidation.mockResolvedValue({
        success: true,
        checks: [
          { name: "build", passed: true },
          { name: "test", passed: true },
          { name: "lint", passed: true },
          { name: "typecheck", passed: true },
        ],
      });

      const result = await runValidationPhase(
        context,
        timer as any,
        isPastState,
        false,
        "thorough" as ExecutionMode,
        checkpoint,
        42,
        "test/repo",
        Date.now(),
        DEFAULT_CONFIG,
        makeFullCommands(),
        "/tmp/aq",
        "/tmp/project"
      );

      expect(result.success).toBe(true);
      expect(mockRunFinalValidation).toHaveBeenCalledWith(
        makeFullCommands(),
        { cwd: "/tmp/project" },
        "thorough",
        "git"
      );
    });

    it("should use different retry counts based on execution mode", async () => {
      const context = makeValidationContext();
      context.maxRetries = 1; // economy mode retry count
      const timer = makeTimer();
      const isPastState = vi.fn().mockReturnValue(false);
      const checkpoint = vi.fn();

      // First validation fails, second succeeds (1 retry for economy mode)
      mockRunFinalValidation
        .mockResolvedValueOnce({
          success: false,
          checks: [{ name: "test", passed: false, output: "Test failed" }],
        })
        .mockResolvedValueOnce({
          success: true,
          checks: [{ name: "test", passed: true }],
        });

      const result = await runValidationPhase(
        context,
        timer as any,
        isPastState,
        false,
        "economy" as ExecutionMode,
        checkpoint,
        42,
        "test/repo",
        Date.now(),
        DEFAULT_CONFIG,
        makeFullCommands(),
        "/tmp/aq",
        "/tmp/project"
      );

      expect(result.success).toBe(true);
      expect(mockRunFinalValidation).toHaveBeenCalledTimes(2); // Initial + 1 retry for economy
      expect(mockRunClaude).toHaveBeenCalledTimes(1); // 1 fix attempt
    });
  });
});