import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));
vi.mock("../../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn(),
  runShell: vi.fn(),
}));
vi.mock("../../../src/prompt/template-renderer.js", () => ({
  assemblePrompt: vi.fn().mockReturnValue({ content: "rendered prompt", cacheHit: false, assemblyTimeMs: 0 }),
  loadTemplate: vi.fn().mockReturnValue("template content"),
  buildBaseLayer: vi.fn().mockReturnValue({ role: "시니어 개발자", rules: [], outputFormat: "", progressReporting: "", parallelWorkGuide: "" }),
  buildProjectLayer: vi.fn().mockReturnValue({ conventions: "", structure: "", testCommand: "", lintCommand: "", safetyRules: [] }),
  buildIssueLayer: vi.fn().mockImplementation((cfg: { number: number; title: string; body: string; labels: string[] }) => ({ ...cfg })),
  buildLearningLayer: vi.fn().mockReturnValue({ pastFailures: [], errorPatterns: [], learnedPatterns: [], updatedAt: "" }),
  extractDesignReferences: vi.fn().mockReturnValue({ designFiles: [], references: [] }),
}));
vi.mock("../../../src/utils/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../../src/review/token-estimator.js", () => ({
  analyzeTokenUsage: vi.fn(),
  summarizeForBudget: vi.fn(),
}));

import { executePhase } from "../../../src/pipeline/execution/phase-executor.js";
import { runClaude } from "../../../src/claude/claude-runner.js";
import { runCli } from "../../../src/utils/cli-runner.js";
import type { PhaseExecutorContext } from "../../../src/pipeline/execution/phase-executor.js";
import { analyzeTokenUsage } from "../../../src/review/token-estimator.js";

const mockRunClaude = vi.mocked(runClaude);
const mockRunCli = vi.mocked(runCli);
const mockAnalyzeTokenUsage = vi.mocked(analyzeTokenUsage);

function makeCtx(overrides: Partial<PhaseExecutorContext> = {}): PhaseExecutorContext {
  return {
    issue: { number: 42, title: "Fix bug", body: "Fix it", labels: [] },
    plan: {
      issueNumber: 42,
      title: "Fix plan",
      problemDefinition: "A bug",
      requirements: [],
      affectedFiles: [],
      risks: [],
      phases: [
        {
          index: 0,
          name: "Phase One",
          description: "Do something",
          targetFiles: ["src/foo.ts"],
          commitStrategy: "atomic",
          verificationCriteria: [],
          dependsOn: [],
        },
      ],
      verificationPoints: [],
      stopConditions: [],
    },
    phase: {
      index: 0,
      name: "Phase One",
      description: "Do something",
      targetFiles: ["src/foo.ts"],
      commitStrategy: "atomic",
      verificationCriteria: [],
      dependsOn: [],
    },
    previousResults: [],
    claudeConfig: {
      path: "claude",
      model: "model-primary",
      models: {
        plan: "model-primary",
        phase: "model-primary",
        review: "model-review",
        fallback: "model-fallback",
      },
      maxTurns: 1,
      timeout: 5000,
      additionalArgs: [],
    },
    promptsDir: "/tmp/prompts",
    cwd: "/tmp/project",
    testCommand: "",
    lintCommand: "",
    gitPath: "git",
    gitConfig: {
      commitMessageTemplate: "[#{{issueNumber}}] {{phase}}: {{summary}}",
    },
    ...overrides,
  };
}

function mockSuccessRunCliSequence(): void {
  mockRunCli
    .mockResolvedValueOnce({ stdout: "startabc123", stderr: "", exitCode: 0 }) // getHeadHash (phaseStartHash)
    .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })             // diff committed (scope guard)
    .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })             // diff uncommitted (scope guard)
    .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })             // git status --porcelain (autoCommit, clean)
    .mockResolvedValueOnce({ stdout: "finaldef456", stderr: "", exitCode: 0 }); // getHeadHash (final)
}

describe("executePhase QUOTA_EXHAUSTED fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeTokenUsage.mockReturnValue({
      estimatedTokens: 1000,
      modelLimit: 200000,
      effectiveLimit: 160000,
      exceedsLimit: false,
      usagePercentage: 0.6,
    });
  });

  it("falls back to second model when first model returns QUOTA_EXHAUSTED", async () => {
    mockRunClaude
      .mockResolvedValueOnce({ success: false, output: "You've hit your limit · resets Apr 15, 2pm" })
      .mockResolvedValueOnce({ success: true, output: "done" });
    mockSuccessRunCliSequence();

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(true);
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
    expect(mockRunClaude.mock.calls[0][0].config.model).toBe("model-primary");
    expect(mockRunClaude.mock.calls[1][0].config.model).toBe("model-fallback");
  });

  it("fails when all fallback models are exhausted or fail", async () => {
    mockRunClaude
      .mockResolvedValueOnce({ success: false, output: "You've hit your limit · resets Apr 15, 2pm" })
      .mockResolvedValueOnce({ success: false, output: "Claude failed: unexpected error" });
    mockRunCli.mockResolvedValue({ stdout: "startabc123", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(false);
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when failure is not QUOTA_EXHAUSTED", async () => {
    mockRunClaude.mockResolvedValueOnce({ success: false, output: "TS2345: type error in file" });
    mockRunCli.mockResolvedValue({ stdout: "startabc123", stderr: "", exitCode: 0 });

    const result = await executePhase(makeCtx());

    expect(result.success).toBe(false);
    // Should fail immediately without trying fallback model
    expect(mockRunClaude).toHaveBeenCalledTimes(1);
  });

  it("uses explicit modelFallbackChain when provided", async () => {
    mockRunClaude
      .mockResolvedValueOnce({ success: false, output: "usage limit reached" })
      .mockResolvedValueOnce({ success: true, output: "done" });
    mockSuccessRunCliSequence();

    const ctx = makeCtx({
      claudeConfig: {
        path: "claude",
        model: "chain-model-a",
        models: {
          plan: "chain-model-a",
          phase: "chain-model-a",
          review: "chain-model-a",
          fallback: "chain-model-a",
        },
        modelFallbackChain: ["chain-model-a", "chain-model-b"],
        maxTurns: 1,
        timeout: 5000,
        additionalArgs: [],
      },
    });

    const result = await executePhase(ctx);

    expect(result.success).toBe(true);
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
    expect(mockRunClaude.mock.calls[1][0].config.model).toBe("chain-model-b");
  });
});
