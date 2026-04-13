import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 선언 (모듈 로딩 전에 위치해야 함) ──────────────────────────────────

vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/pipeline/setup/pipeline-git-setup.js", () => ({
  setupGitEnvironment: vi.fn(),
  prepareWorkEnvironment: vi.fn(),
}));

vi.mock("../../../src/pipeline/phases/pipeline-review.js", () => ({
  runReviewPhase: vi.fn(),
  runSimplifyPhase: vi.fn(),
}));

vi.mock("../../../src/pipeline/setup/pipeline-validation.js", () => ({
  runValidationPhase: vi.fn(),
}));

vi.mock("../../../src/pipeline/phases/pipeline-publish.js", () => ({
  pushAndCreatePR: vi.fn(),
  cleanupOnSuccess: vi.fn(),
}));

vi.mock("../../../src/pipeline/automation/automation-dispatcher.js", () => ({
  dispatchPipelineEvent: vi.fn(),
}));

vi.mock("../../../src/pipeline/reporting/result-reporter.js", () => ({
  formatResult: vi.fn(() => ({
    success: true,
    issueNumber: 42,
    repo: "test/repo",
    phases: [],
    startTime: Date.now(),
  })),
}));

vi.mock("../../../src/config/mode-presets.js", () => ({
  getModePreset: vi.fn(() => ({ planHint: "", skipFinalValidation: false })),
  getExecutionModePreset: vi.fn(() => ({
    skipReview: false,
    skipSimplify: false,
    skipValidation: false,
  })),
  detectExecutionModeFromLabels: vi.fn(() => "standard"),
}));

vi.mock("../../../src/pipeline/core/pipeline-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/pipeline/core/pipeline-context.js")>();
  return {
    ...actual,
    saveResult: vi.fn(),
  };
});

// 사용되지 않는 경로도 mock 처리 (module import 실패 방지)
vi.mock("../../../src/pipeline/core/core-loop.js", () => ({ runCoreLoop: vi.fn() }));
vi.mock("../../../src/config/project-resolver.js", () => ({ resolveProject: vi.fn() }));
vi.mock("../../../src/learning/pattern-store.js", () => ({
  PatternStore: vi.fn().mockImplementation(() => ({
    getRecentFailures: vi.fn().mockReturnValue([]),
    formatForPrompt: vi.fn().mockReturnValue(""),
  })),
}));
vi.mock("../../../src/pipeline/errors/pipeline-error-handler.js", () => ({
  handleCoreLoopFailure: vi.fn(),
  routeError: vi.fn(),
}));
vi.mock("../../../src/pipeline/setup/pipeline-setup.js", () => ({
  resolveResolvedProject: vi.fn(),
  checkDuplicatePR: vi.fn(),
  fetchAndValidateIssue: vi.fn(),
}));
vi.mock("../../../src/pipeline/automation/ci-checker.js", () => ({
  pollCiStatus: vi.fn(),
  autoFixCiFailures: vi.fn(),
}));
vi.mock("../../../src/hooks/hook-registry.js", () => ({
  HookRegistry: vi.fn().mockImplementation(() => ({
    hasHooks: vi.fn(() => false),
    getHooks: vi.fn(() => []),
  })),
}));
vi.mock("../../../src/hooks/hook-executor.js", () => ({
  HookExecutor: vi.fn().mockImplementation(() => ({
    executeHooks: vi.fn().mockResolvedValue([]),
    updateVariables: vi.fn(),
  })),
}));

// ── Import (mock 선언 이후) ──────────────────────────────────────────────────

import {
  executeEnvironmentSetup,
  executePostProcessingPhases,
} from "../../../src/pipeline/phases/pipeline-phases.js";
import { setupGitEnvironment, prepareWorkEnvironment } from "../../../src/pipeline/setup/pipeline-git-setup.js";
import { runReviewPhase, runSimplifyPhase } from "../../../src/pipeline/phases/pipeline-review.js";
import { runValidationPhase } from "../../../src/pipeline/setup/pipeline-validation.js";
import { pushAndCreatePR, cleanupOnSuccess } from "../../../src/pipeline/phases/pipeline-publish.js";
import { PSEUDO_PHASE_INDEX } from "../../../src/pipeline/reporting/phase-result-helper.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { PipelineTimer } from "../../../src/safety/timeout-manager.js";
import type { PhaseResult } from "../../../src/types/pipeline.js";
import type { PipelineRuntime } from "../../../src/pipeline/core/pipeline-context.js";

const mockSetupGitEnvironment = vi.mocked(setupGitEnvironment);
const mockPrepareWorkEnvironment = vi.mocked(prepareWorkEnvironment);
const mockRunReviewPhase = vi.mocked(runReviewPhase);
const mockRunSimplifyPhase = vi.mocked(runSimplifyPhase);
const mockRunValidationPhase = vi.mocked(runValidationPhase);
const mockPushAndCreatePR = vi.mocked(pushAndCreatePR);
const mockCleanupOnSuccess = vi.mocked(cleanupOnSuccess);

// ── 테스트 픽스처 헬퍼 ──────────────────────────────────────────────────────

function makeConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  config.general.projectName = "test";
  config.general.targetRoot = "/tmp/project";
  config.git.allowedRepos = ["test/repo"];
  return config;
}

function makeRuntime(overrides: Partial<PipelineRuntime> = {}): PipelineRuntime {
  return {
    state: "VALIDATED",
    projectRoot: "/tmp/project",
    gitConfig: {
      gitPath: "git",
      allowedRepos: ["test/repo"],
      autoCreateBranch: true,
      defaultBaseBranch: "main",
      branchTemplate: "ax/{issue-number}-{slug}",
    },
    promptsDir: "/tmp/project/prompts",
    rollbackStrategy: "none",
    ...overrides,
  };
}

function makeIssue() {
  return { number: 42, title: "Fix bug", body: "Fix it", labels: [] };
}

function makeProject() {
  return {
    repo: "test/repo",
    path: "/tmp/project",
    baseBranch: "main",
    branchTemplate: "ax/{issue-number}-{slug}",
    commands: { claudeCli: "claude", ghPath: "gh", gitPath: "git", npmPath: "npm" },
    review: { enabled: false, rounds: [], maxRetries: 0 },
    pr: { draftByDefault: true, autoMerge: false, closeIssueOnMerge: true },
    safety: { rollbackStrategy: "none" as const, maxRetries: 2, maxTotalDurationMs: 3600000 },
  };
}

function makeCoreResult(): import("../../../src/pipeline/core/core-loop.js").CoreLoopResult {
  return {
    plan: {
      issueNumber: 42,
      title: "Fix bug",
      problemDefinition: "Bug",
      requirements: [],
      affectedFiles: [],
      risks: [],
      phases: [{ index: 0, name: "Fix", description: "", targetFiles: [], commitStrategy: "", verificationCriteria: [], dependsOn: [] }],
      verificationPoints: [],
      stopConditions: [],
    },
    phaseResults: [{ phaseIndex: 0, phaseName: "Fix", success: true, commitHash: "abc12345", durationMs: 1000 }],
    success: true,
    totalCostUsd: 0.1,
  };
}

// ── executeEnvironmentSetup 테스트 ─────────────────────────────────────────

describe("executeEnvironmentSetup - phaseResults 누적", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("worktree + dependency 설정이 모두 성공하면 2개의 phaseResult가 반환된다", async () => {
    mockSetupGitEnvironment.mockResolvedValue({
      state: "WORKTREE_CREATED" as const,
      branchName: "ax/42-fix-bug",
      worktreePath: "/tmp/wt/42-fix-bug",
    });
    mockPrepareWorkEnvironment.mockResolvedValue({
      rollbackHash: undefined,
      projectConventions: "conventions",
      skillsContext: "skills",
      repoStructure: "structure",
    });

    const runtime = makeRuntime();
    const result = await executeEnvironmentSetup(
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      runtime,
      makeIssue(),
      makeProject() as ReturnType<typeof makeProject>,
      makeRuntime().gitConfig,
      "/tmp/project",
      makeConfig(),
      vi.fn()
    );

    expect(result.phaseResults).toHaveLength(2);
  });

  it("첫 번째 phaseResult는 setup:worktree (phaseIndex -7) 성공이다", async () => {
    mockSetupGitEnvironment.mockResolvedValue({
      state: "WORKTREE_CREATED" as const,
      branchName: "ax/42-fix-bug",
      worktreePath: "/tmp/wt/42-fix-bug",
    });
    mockPrepareWorkEnvironment.mockResolvedValue({
      rollbackHash: undefined,
      projectConventions: "",
      skillsContext: "",
      repoStructure: "",
    });

    const result = await executeEnvironmentSetup(
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeRuntime(),
      makeIssue(),
      makeProject() as ReturnType<typeof makeProject>,
      makeRuntime().gitConfig,
      "/tmp/project",
      makeConfig(),
      vi.fn()
    );

    const worktreePhase = result.phaseResults[0];
    expect(worktreePhase.phaseName).toBe("setup:worktree");
    expect(worktreePhase.phaseIndex).toBe(PSEUDO_PHASE_INDEX["setup:worktree"]);
    expect(worktreePhase.phaseIndex).toBe(-7);
    expect(worktreePhase.success).toBe(true);
    expect(worktreePhase.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("두 번째 phaseResult는 setup:dependency (phaseIndex -6) 성공이다", async () => {
    mockSetupGitEnvironment.mockResolvedValue({
      state: "WORKTREE_CREATED" as const,
      branchName: "ax/42-fix-bug",
      worktreePath: "/tmp/wt/42-fix-bug",
    });
    mockPrepareWorkEnvironment.mockResolvedValue({
      rollbackHash: "abc123",
      projectConventions: "conventions",
      skillsContext: "skills",
      repoStructure: "structure",
    });

    const result = await executeEnvironmentSetup(
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeRuntime(),
      makeIssue(),
      makeProject() as ReturnType<typeof makeProject>,
      makeRuntime().gitConfig,
      "/tmp/project",
      makeConfig(),
      vi.fn()
    );

    const depPhase = result.phaseResults[1];
    expect(depPhase.phaseName).toBe("setup:dependency");
    expect(depPhase.phaseIndex).toBe(PSEUDO_PHASE_INDEX["setup:dependency"]);
    expect(depPhase.phaseIndex).toBe(-6);
    expect(depPhase.success).toBe(true);
  });

  it("worktreePath가 설정되지 않으면 setup:dependency가 기록되지 않는다", async () => {
    // worktreePath를 undefined로 반환하면 transitionState 후 runtime.worktreePath가 없음
    mockSetupGitEnvironment.mockResolvedValue({
      state: "WORKTREE_CREATED" as const,
      branchName: "ax/42-fix-bug",
      worktreePath: undefined as unknown as string,
    });

    // runtime에 worktreePath가 없는 상태로 시작
    const runtime = makeRuntime({ worktreePath: undefined });

    const result = await executeEnvironmentSetup(
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      runtime,
      makeIssue(),
      makeProject() as ReturnType<typeof makeProject>,
      makeRuntime().gitConfig,
      "/tmp/project",
      makeConfig(),
      vi.fn()
    );

    // setup:worktree만 기록되고, setup:dependency는 기록되지 않는다
    expect(result.phaseResults).toHaveLength(1);
    expect(result.phaseResults[0].phaseName).toBe("setup:worktree");
    expect(mockPrepareWorkEnvironment).not.toHaveBeenCalled();
  });

  it("phaseResult에 startedAt, completedAt 타임스탬프가 포함된다", async () => {
    mockSetupGitEnvironment.mockResolvedValue({
      state: "WORKTREE_CREATED" as const,
      branchName: "ax/42-fix-bug",
      worktreePath: "/tmp/wt/42-fix-bug",
    });
    mockPrepareWorkEnvironment.mockResolvedValue({
      rollbackHash: undefined,
      projectConventions: "",
      skillsContext: "",
      repoStructure: "",
    });

    const result = await executeEnvironmentSetup(
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeRuntime(),
      makeIssue(),
      makeProject() as ReturnType<typeof makeProject>,
      makeRuntime().gitConfig,
      "/tmp/project",
      makeConfig(),
      vi.fn()
    );

    for (const phase of result.phaseResults) {
      expect(phase.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(phase.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });
});

// ── executePostProcessingPhases - phaseResults 누적 테스트 ──────────────────

describe("executePostProcessingPhases - accumulatedPhaseResults 누적", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCleanupOnSuccess.mockResolvedValue(undefined);
  });

  function makePostProcessingContext(
    accumulatedPhaseResults: PhaseResult[] = []
  ) {
    const timer = new PipelineTimer(3_600_000); // 1시간 타임아웃
    return {
      issue: makeIssue(),
      coreResult: makeCoreResult(),
      gitConfig: makeRuntime().gitConfig,
      project: makeProject() as ReturnType<typeof makeProject>,
      worktreePath: "/tmp/wt/42-fix-bug",
      promptsDir: "/tmp/project/prompts",
      skillsContext: "",
      preset: { planHint: "", skipFinalValidation: false },
      timer,
      checkpoint: vi.fn(),
      accumulatedPhaseResults,
    };
  }

  it("정상 파이프라인: review:code, validation:check, publish:pr이 accumulatedPhaseResults에 추가된다", async () => {
    mockRunReviewPhase.mockResolvedValue({ success: true, costUsd: 0, reviewVariables: undefined });
    mockRunValidationPhase.mockResolvedValue({ success: true });
    mockPushAndCreatePR.mockResolvedValue({ success: true, prUrl: "https://github.com/test/repo/pull/1", prNumber: 1 });

    const accumulatedPhaseResults: PhaseResult[] = [];
    const context = makePostProcessingContext(accumulatedPhaseResults);
    const runtime = makeRuntime({ worktreePath: "/tmp/wt/42-fix-bug", branchName: "ax/42-fix-bug" });

    await executePostProcessingPhases(context, runtime, {
      issueNumber: 42,
      repo: "test/repo",
      config: makeConfig(),
      projectRoot: "/tmp/project",
    }, makeConfig(), Date.now());

    // review:code, validation:check, publish:pr 세 phase가 추가되어야 한다
    expect(accumulatedPhaseResults.length).toBeGreaterThanOrEqual(2);
    const names = accumulatedPhaseResults.map((r) => r.phaseName);
    expect(names).toContain("review:code");
    expect(names).toContain("validation:check");
    expect(names).toContain("publish:pr");
  });

  it("review:code phase 성공 시 success=true로 기록된다", async () => {
    mockRunReviewPhase.mockResolvedValue({ success: true, costUsd: 0.05, reviewVariables: undefined });
    mockRunValidationPhase.mockResolvedValue({ success: true });
    mockPushAndCreatePR.mockResolvedValue({ success: true, prUrl: "https://github.com/test/repo/pull/1", prNumber: 1 });

    const accumulatedPhaseResults: PhaseResult[] = [];
    await executePostProcessingPhases(
      makePostProcessingContext(accumulatedPhaseResults),
      makeRuntime({ worktreePath: "/tmp/wt/42-fix-bug", branchName: "ax/42-fix-bug" }),
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeConfig(),
      Date.now()
    );

    const reviewPhase = accumulatedPhaseResults.find((r) => r.phaseName === "review:code");
    expect(reviewPhase).toBeDefined();
    expect(reviewPhase!.success).toBe(true);
    expect(reviewPhase!.phaseIndex).toBe(PSEUDO_PHASE_INDEX["review:code"]);
    expect(reviewPhase!.phaseIndex).toBe(-4);
  });

  it("review:simplify는 reviewVariables가 없으면 기록되지 않는다", async () => {
    // reviewVariables가 undefined이면 simplify 단계를 건너뜀
    mockRunReviewPhase.mockResolvedValue({ success: true, costUsd: 0, reviewVariables: undefined });
    mockRunValidationPhase.mockResolvedValue({ success: true });
    mockPushAndCreatePR.mockResolvedValue({ success: true, prUrl: "https://github.com/test/repo/pull/1", prNumber: 1 });

    const accumulatedPhaseResults: PhaseResult[] = [];
    await executePostProcessingPhases(
      makePostProcessingContext(accumulatedPhaseResults),
      makeRuntime({ worktreePath: "/tmp/wt/42-fix-bug", branchName: "ax/42-fix-bug" }),
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeConfig(),
      Date.now()
    );

    const simplifyPhase = accumulatedPhaseResults.find((r) => r.phaseName === "review:simplify");
    expect(simplifyPhase).toBeUndefined();
    expect(mockRunSimplifyPhase).not.toHaveBeenCalled();
  });

  it("review:simplify는 reviewVariables가 있으면 기록된다", async () => {
    mockRunReviewPhase.mockResolvedValue({
      success: true,
      costUsd: 0.03,
      reviewVariables: { diff: "some diff", findings: [] },
    });
    mockRunSimplifyPhase.mockResolvedValue({ success: true, costUsd: 0.02 });
    mockRunValidationPhase.mockResolvedValue({ success: true });
    mockPushAndCreatePR.mockResolvedValue({ success: true, prUrl: "https://github.com/test/repo/pull/1", prNumber: 1 });

    const accumulatedPhaseResults: PhaseResult[] = [];
    await executePostProcessingPhases(
      makePostProcessingContext(accumulatedPhaseResults),
      makeRuntime({ worktreePath: "/tmp/wt/42-fix-bug", branchName: "ax/42-fix-bug" }),
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeConfig(),
      Date.now()
    );

    const simplifyPhase = accumulatedPhaseResults.find((r) => r.phaseName === "review:simplify");
    expect(simplifyPhase).toBeDefined();
    expect(simplifyPhase!.success).toBe(true);
    expect(simplifyPhase!.phaseIndex).toBe(PSEUDO_PHASE_INDEX["review:simplify"]);
    expect(simplifyPhase!.phaseIndex).toBe(-3);
  });

  it("review 실패 시 review:code가 success=false로 기록된다", async () => {
    mockRunReviewPhase.mockResolvedValue({
      success: false,
      costUsd: 0.01,
      error: "Review failed: missing tests",
      reviewVariables: undefined,
    });

    const accumulatedPhaseResults: PhaseResult[] = [];
    const context = makePostProcessingContext(accumulatedPhaseResults);
    const runtime = makeRuntime({ worktreePath: "/tmp/wt/42-fix-bug", branchName: "ax/42-fix-bug" });

    await expect(
      executePostProcessingPhases(context, runtime, {
        issueNumber: 42,
        repo: "test/repo",
        config: makeConfig(),
        projectRoot: "/tmp/project",
      }, makeConfig(), Date.now())
    ).rejects.toThrow("Review failed: missing tests");

    const reviewPhase = accumulatedPhaseResults.find((r) => r.phaseName === "review:code");
    expect(reviewPhase).toBeDefined();
    expect(reviewPhase!.success).toBe(false);
    expect(reviewPhase!.error).toBe("Review failed: missing tests");
  });

  it("publish:pr phase의 phaseIndex는 -1이다", async () => {
    mockRunReviewPhase.mockResolvedValue({ success: true, costUsd: 0, reviewVariables: undefined });
    mockRunValidationPhase.mockResolvedValue({ success: true });
    mockPushAndCreatePR.mockResolvedValue({ success: true, prUrl: "https://github.com/test/repo/pull/1", prNumber: 1 });

    const accumulatedPhaseResults: PhaseResult[] = [];
    await executePostProcessingPhases(
      makePostProcessingContext(accumulatedPhaseResults),
      makeRuntime({ worktreePath: "/tmp/wt/42-fix-bug", branchName: "ax/42-fix-bug" }),
      { issueNumber: 42, repo: "test/repo", config: makeConfig(), projectRoot: "/tmp/project" },
      makeConfig(),
      Date.now()
    );

    const publishPhase = accumulatedPhaseResults.find((r) => r.phaseName === "publish:pr");
    expect(publishPhase).toBeDefined();
    expect(publishPhase!.phaseIndex).toBe(-1);
    expect(publishPhase!.phaseIndex).toBe(PSEUDO_PHASE_INDEX["publish:pr"]);
  });
});

// ── phaseIndex 재번호 정확성 테스트 ────────────────────────────────────────

describe("phaseIndex 재번호 정확성", () => {
  it("pseudo-phase 인덱스는 core-loop phase 인덱스(0 이상)와 겹치지 않는다", () => {
    const pseudoIndices = Object.values(PSEUDO_PHASE_INDEX);
    for (const idx of pseudoIndices) {
      expect(idx).toBeLessThan(0);
    }
    // core-loop phase 인덱스는 0부터 시작
    const corePhaseIndices = [0, 1, 2, 3, 4];
    for (const coreIdx of corePhaseIndices) {
      expect(pseudoIndices).not.toContain(coreIdx);
    }
  });

  it("pseudo-phase 인덱스 순서: setup:worktree < setup:dependency < ... < publish:pr", () => {
    expect(PSEUDO_PHASE_INDEX["setup:worktree"]).toBeLessThan(PSEUDO_PHASE_INDEX["setup:dependency"]);
    expect(PSEUDO_PHASE_INDEX["setup:dependency"]).toBeLessThan(PSEUDO_PHASE_INDEX["plan:generate"]);
    expect(PSEUDO_PHASE_INDEX["plan:generate"]).toBeLessThan(PSEUDO_PHASE_INDEX["review:code"]);
    expect(PSEUDO_PHASE_INDEX["review:code"]).toBeLessThan(PSEUDO_PHASE_INDEX["review:simplify"]);
    expect(PSEUDO_PHASE_INDEX["review:simplify"]).toBeLessThan(PSEUDO_PHASE_INDEX["validation:check"]);
    expect(PSEUDO_PHASE_INDEX["validation:check"]).toBeLessThan(PSEUDO_PHASE_INDEX["publish:pr"]);
    expect(PSEUDO_PHASE_INDEX["publish:pr"]).toBe(-1); // 가장 마지막
  });
});
