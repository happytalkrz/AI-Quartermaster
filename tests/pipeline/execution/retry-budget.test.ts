import { describe, it, expect, vi, beforeEach } from "vitest";

// === Mocks for retryWithClaudeFix ===
vi.mock("../../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../../src/claude/model-router.js", () => ({
  configForTask: vi.fn(),
  configForTaskWithMode: vi.fn().mockReturnValue({ model: "fallback-model" }),
}));
vi.mock("../../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn(),
  getHeadHash: vi.fn(),
}));
vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// === Mocks for core-loop ===
vi.mock("../../../src/pipeline/phases/plan-generator.js", () => ({
  generatePlan: vi.fn(),
}));
vi.mock("../../../src/pipeline/execution/phase-executor.js", () => ({
  executePhase: vi.fn(),
}));
vi.mock("../../../src/pipeline/execution/phase-retry.js", () => ({
  retryPhase: vi.fn(),
}));
vi.mock("../../../src/safety/phase-limit-guard.js", () => ({
  checkPhaseLimit: vi.fn(),
}));
vi.mock("../../../src/pipeline/execution/phase-scheduler.js", () => ({
  schedulePhases: vi.fn(),
}));
vi.mock("../../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn().mockImplementation(() => ({
    getRecentFailures: vi.fn().mockReturnValue([]),
    formatForPrompt: vi.fn().mockReturnValue(""),
  })),
}));
vi.mock("../../../src/prompt/template-renderer.js", () => ({
  buildBaseLayer: vi.fn().mockReturnValue({
    role: "시니어 개발자",
    rules: [],
    outputFormat: "",
    progressReporting: "",
    parallelWorkGuide: "",
  }),
  buildProjectLayer: vi.fn().mockReturnValue({
    conventions: "",
    structure: "",
    testCommand: "npm test",
    lintCommand: "npm run lint",
    safetyRules: [],
  }),
  buildStaticContent: vi.fn().mockReturnValue("static-content"),
  loadTemplate: vi.fn().mockImplementation(() => {
    throw new Error("Template not found: /tmp/prompts/phase-implementation.md");
  }),
  computeLayerCacheKey: vi.fn().mockReturnValue("mock-cache-key"),
}));

import { retryWithClaudeFix, type RetryWithFixOptions } from "../../../src/pipeline/execution/retry-with-fix.js";
import { runClaude } from "../../../src/claude/claude-runner.js";
import { configForTaskWithMode } from "../../../src/claude/model-router.js";
import { autoCommitIfDirty } from "../../../src/git/commit-helper.js";
import { runCoreLoop, type CoreLoopContext } from "../../../src/pipeline/core/core-loop.js";
import { generatePlan } from "../../../src/pipeline/phases/plan-generator.js";
import { executePhase } from "../../../src/pipeline/execution/phase-executor.js";
import { retryPhase } from "../../../src/pipeline/execution/phase-retry.js";
import { schedulePhases } from "../../../src/pipeline/execution/phase-scheduler.js";
import type { Plan, Phase, PhaseResult } from "../../../src/types/pipeline.js";

const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTaskWithMode = vi.mocked(configForTaskWithMode);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);
const mockGeneratePlan = vi.mocked(generatePlan);
const mockExecutePhase = vi.mocked(executePhase);
const mockRetryPhase = vi.mocked(retryPhase);
const mockSchedulePhases = vi.mocked(schedulePhases);

// ============================================================
// Test helpers
// ============================================================

function makePhase(index: number, name: string): Phase {
  return {
    index,
    name,
    description: `Phase ${name} description`,
    targetFiles: [`src/${name.toLowerCase()}.ts`],
    commitStrategy: "atomic",
    verificationCriteria: [`${name} complete`],
  };
}

function makePlan(phases: Phase[]): Plan {
  return {
    issueNumber: 1,
    title: "Test Plan",
    problemDefinition: "Test problem",
    requirements: ["Req 1"],
    affectedFiles: ["src/app.ts"],
    risks: [],
    phases,
    verificationPoints: [],
    stopConditions: [],
  };
}

function makePhaseFailure(
  phaseIndex: number,
  phaseName: string,
  error = "TS compilation error",
): PhaseResult {
  return {
    phaseIndex,
    phaseName,
    success: false,
    error,
    errorCategory: "TS_ERROR",
    durationMs: 500,
  };
}

function makePhaseSuccess(phaseIndex: number, phaseName: string): PhaseResult {
  return {
    phaseIndex,
    phaseName,
    success: true,
    commitHash: "abc123",
    durationMs: 1000,
  };
}

function makeCoreLoopContext(overrides: Partial<CoreLoopContext> = {}): CoreLoopContext {
  return {
    issue: { number: 1, title: "Test Issue", body: "Body", labels: [] },
    repo: { owner: "test", name: "repo" },
    branch: { base: "main", work: "feature-branch" },
    repoStructure: "src/\n  app.ts\n",
    config: {
      commands: {
        claudeCli: { path: "claude", model: "test", maxTurns: 1, timeout: 5000, additionalArgs: [] },
        test: "npm test",
        lint: "npm run lint",
      },
      safety: {
        maxPhases: 10,
        maxRetries: 2,
        sensitivePaths: [".env"],
      },
      git: {
        gitPath: "git",
        allowedRepos: ["test/repo"],
        autoCreateBranch: true,
        defaultBaseBranch: "main",
      },
      general: {
        projectName: "test",
        targetRoot: "/tmp",
        tempDir: "/tmp",
      },
      queue: {
        concurrency: 1,
        retryDelayMs: 1000,
        stuckTimeoutMs: 300000,
        persistenceFile: "/tmp/queue.json",
      },
      github: {
        token: "token",
        webhookSecret: "secret",
        enableAutoMerge: false,
      },
      server: {
        port: 3000,
        host: "localhost",
      },
      features: {
        parallelPhases: false,
      },
    } as any,
    promptsDir: "/tmp/prompts",
    cwd: "/tmp/project",
    // baseline을 미리 제공하여 captureErrorBaseline 호출을 건너뜀
    baseline: {
      tsc: { totalErrors: 0, errorsByFile: {} },
      eslint: { totalErrors: 0, errorsByFile: {} },
    } as any,
    ...overrides,
  };
}

// ============================================================
// 1. retryWithClaudeFix — retry budget 소진 검증
// ============================================================

describe("retryWithClaudeFix — retry budget 소진 시 RETRY_BUDGET_EXHAUSTED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigForTaskWithMode.mockReturnValue({ model: "fallback-model" });
    mockAutoCommitIfDirty.mockResolvedValue(false);
  });

  it("revalidateFn이 계속 실패하면 maxRetries 소진 후 RETRY_BUDGET_EXHAUSTED 에러로 실패한다", async () => {
    const failedResult = { errors: ["compilation error"] };

    mockRunClaude.mockResolvedValue({ success: true, output: "applied fix" });

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue("Fix these errors: compilation error"),
      revalidateFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      maxRetries: 2,
      claudeConfig: { model: "test-model" } as any,
      cwd: "/tmp",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: retry {attempt}",
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("RETRY_BUDGET_EXHAUSTED");
    // runClaude는 maxRetries 횟수만큼 호출됨
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it("maxRetries=1일 때 1회 시도 후 RETRY_BUDGET_EXHAUSTED로 실패하며 attempt 횟수가 1임을 검증한다", async () => {
    const failedResult = { errors: ["error"] };

    mockRunClaude.mockResolvedValue({ success: true, output: "ok" });

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue("fix prompt"),
      revalidateFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      maxRetries: 1,
      claudeConfig: { model: "test-model" } as any,
      cwd: "/tmp",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: retry {attempt}",
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain("RETRY_BUDGET_EXHAUSTED");
    expect(result.error).toContain("1 attempt");
  });

  it("Claude CLI가 에러를 반환해도(throw) maxRetries 소진 후 success=false를 반환한다", async () => {
    const failedResult = { errors: ["error"] };

    // runClaude가 매번 throw — Claude CLI 에러 시뮬레이션
    mockRunClaude.mockRejectedValue(new Error("Claude CLI failed: exit code 1"));

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue("fix prompt"),
      revalidateFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      maxRetries: 3,
      claudeConfig: { model: "test-model" } as any,
      cwd: "/tmp",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: retry {attempt}",
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toBeDefined();
  });

  it("onFailure 콜백이 maxRetries 도달 시 정확히 1회 호출된다", async () => {
    const failedResult = { errors: ["error"] };
    const onFailure = vi.fn();

    mockRunClaude.mockResolvedValue({ success: true, output: "ok" });

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue("fix prompt"),
      revalidateFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      maxRetries: 2,
      claudeConfig: { model: "test-model" } as any,
      cwd: "/tmp",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: retry {attempt}",
      onFailure,
    };

    await retryWithClaudeFix(options);

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(2, failedResult);
  });
});

// ============================================================
// 2. retryPhase — core-loop에서 상한 초과 시 정상 실패 검증
// ============================================================

describe("retryPhase — core-loop에서 retry 상한 초과 시 정상 실패", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSchedulePhases.mockReturnValue({ success: true, groups: [] });
  });

  it("retryPhase가 maxRetries(=2) 횟수만큼만 호출되고 그 이상 호출되지 않는다 (무한 루프 방지)", async () => {
    const phases = [makePhase(0, "BuggyPhase")];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [{ level: 0, phases }],
    });

    // 초기 실행 실패 (TS_ERROR → retryable)
    mockExecutePhase.mockResolvedValueOnce(makePhaseFailure(0, "BuggyPhase"));

    // retryPhase: maxRetries(=2)번 모두 실패
    mockRetryPhase
      .mockResolvedValueOnce(makePhaseFailure(0, "BuggyPhase", "Retry 1 failed"))
      .mockResolvedValueOnce(makePhaseFailure(0, "BuggyPhase", "Retry 2 failed"));

    const result = await runCoreLoop(makeCoreLoopContext());

    // 정확히 maxRetries(=2)번만 호출됨
    expect(mockRetryPhase).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
  });

  it("retry 상한 도달 후 마지막 실패 결과가 phaseResults에 포함된다", async () => {
    const phases = [makePhase(0, "FailingPhase")];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [{ level: 0, phases }],
    });

    mockExecutePhase.mockResolvedValueOnce(makePhaseFailure(0, "FailingPhase", "Initial error"));
    mockRetryPhase
      .mockResolvedValueOnce(makePhaseFailure(0, "FailingPhase", "Retry 1 error"))
      .mockResolvedValueOnce(makePhaseFailure(0, "FailingPhase", "Retry 2 error — budget exhausted"));

    const result = await runCoreLoop(makeCoreLoopContext());

    expect(result.success).toBe(false);

    const failedResult = result.phaseResults.find(r => r.phaseIndex === 0);
    expect(failedResult).toBeDefined();
    expect(failedResult!.success).toBe(false);
    // 마지막 retry 결과가 최종 결과로 기록됨
    expect(failedResult!.error).toContain("Retry 2 error");
  });

  it("retryPhase 호출 시 attempt 번호가 1부터 maxRetries까지 순서대로 전달된다", async () => {
    const phases = [makePhase(0, "CheckAttempt")];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [{ level: 0, phases }],
    });

    mockExecutePhase.mockResolvedValueOnce(makePhaseFailure(0, "CheckAttempt"));
    mockRetryPhase
      .mockResolvedValueOnce(makePhaseFailure(0, "CheckAttempt", "Attempt 1"))
      .mockResolvedValueOnce(makePhaseFailure(0, "CheckAttempt", "Attempt 2"));

    await runCoreLoop(makeCoreLoopContext());

    expect(mockRetryPhase).toHaveBeenNthCalledWith(1, expect.objectContaining({ attempt: 1, maxRetries: 2 }));
    expect(mockRetryPhase).toHaveBeenNthCalledWith(2, expect.objectContaining({ attempt: 2, maxRetries: 2 }));
  });
});

// ============================================================
// 3. core-loop — 전체 retry 소진 후 파이프라인 failed 확정
// ============================================================

describe("core-loop — 전체 retry 소진 후 파이프라인 failed 확정", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSchedulePhases.mockReturnValue({ success: true, groups: [] });
  });

  it("단일 phase가 모든 retry를 소진하면 파이프라인 전체가 failed로 끝난다", async () => {
    const phases = [makePhase(0, "AlwaysFails")];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [{ level: 0, phases }],
    });

    // 초기 실행 + retry 2회 모두 실패 (maxRetries=2)
    mockExecutePhase.mockResolvedValueOnce(makePhaseFailure(0, "AlwaysFails"));
    mockRetryPhase
      .mockResolvedValueOnce(makePhaseFailure(0, "AlwaysFails", "Attempt 1 failed"))
      .mockResolvedValueOnce(makePhaseFailure(0, "AlwaysFails", "Attempt 2 failed"));

    const result = await runCoreLoop(makeCoreLoopContext());

    expect(result.success).toBe(false);
    expect(result.plan).toBeDefined();
    // phaseResults에 plan:generate pseudo-phase + failed phase 포함
    expect(result.phaseResults.length).toBeGreaterThanOrEqual(2);
    expect(result.phaseResults.some(r => r.phaseIndex === 0 && !r.success)).toBe(true);
  });

  it("retry 소진으로 실패한 phase 이후의 phase는 실행되지 않는다", async () => {
    const phases = [
      makePhase(0, "FailPhase"),
      makePhase(1, "NextPhase"),
    ];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    // 순차 그룹: phase 0 실패 시 phase 1은 실행 안 됨
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [
        { level: 0, phases: [phases[0]] },
        { level: 1, phases: [phases[1]] },
      ],
    });

    // Phase 0: 초기 실패 + 모든 retry 소진
    mockExecutePhase.mockResolvedValueOnce(makePhaseFailure(0, "FailPhase"));
    mockRetryPhase
      .mockResolvedValueOnce(makePhaseFailure(0, "FailPhase", "Retry 1"))
      .mockResolvedValueOnce(makePhaseFailure(0, "FailPhase", "Retry 2 — final"));

    const result = await runCoreLoop(makeCoreLoopContext());

    expect(result.success).toBe(false);
    // Phase 1은 실행되지 않음
    expect(result.phaseResults.find(r => r.phaseIndex === 1)).toBeUndefined();
    // Phase 0 실패 결과는 포함됨
    const phase0Result = result.phaseResults.find(r => r.phaseIndex === 0);
    expect(phase0Result).toBeDefined();
    expect(phase0Result!.success).toBe(false);
  });

  it("maxRetries=0이면 retry 없이 즉시 파이프라인이 failed로 끝난다", async () => {
    const phases = [makePhase(0, "NoRetryPhase")];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [{ level: 0, phases }],
    });

    mockExecutePhase.mockResolvedValueOnce(makePhaseFailure(0, "NoRetryPhase"));

    const context = makeCoreLoopContext();
    (context.config.safety as any).maxRetries = 0;

    const result = await runCoreLoop(context);

    expect(result.success).toBe(false);
    // retry 없이 즉시 실패 — retryPhase 미호출
    expect(mockRetryPhase).not.toHaveBeenCalled();
  });

  it("성공한 phase 이후 다음 phase가 retry 소진으로 실패하면 파이프라인은 failed이다", async () => {
    const phases = [
      makePhase(0, "SuccessPhase"),
      makePhase(1, "ExhaustedPhase"),
    ];
    const plan = makePlan(phases);

    mockGeneratePlan.mockResolvedValue({ plan });
    mockSchedulePhases.mockReturnValue({
      success: true,
      groups: [
        { level: 0, phases: [phases[0]] },
        { level: 1, phases: [phases[1]] },
      ],
    });

    // Phase 0 성공
    mockExecutePhase
      .mockResolvedValueOnce(makePhaseSuccess(0, "SuccessPhase"))
      // Phase 1 초기 실패
      .mockResolvedValueOnce(makePhaseFailure(1, "ExhaustedPhase", "Phase 1 initial error"));

    // Phase 1 retry 2회 모두 실패
    mockRetryPhase
      .mockResolvedValueOnce(makePhaseFailure(1, "ExhaustedPhase", "Phase 1 retry 1"))
      .mockResolvedValueOnce(makePhaseFailure(1, "ExhaustedPhase", "Phase 1 retry 2"));

    const result = await runCoreLoop(makeCoreLoopContext());

    expect(result.success).toBe(false);
    // Phase 0은 성공 결과 보존
    const phase0Result = result.phaseResults.find(r => r.phaseIndex === 0);
    expect(phase0Result?.success).toBe(true);
    // Phase 1은 실패
    const phase1Result = result.phaseResults.find(r => r.phaseIndex === 1);
    expect(phase1Result?.success).toBe(false);
  });
}, { timeout: 300000 });
