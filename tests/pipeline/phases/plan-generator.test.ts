import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../../src/prompt/template-renderer.js", () => ({
  loadTemplate: vi.fn(() => "# mock template"),
  renderTemplate: vi.fn(() => "rendered prompt"),
  extractDesignReferences: vi.fn(() => ({ designFiles: [] as string[] })),
  buildDynamicSection: vi.fn(() => ""),
}));

vi.mock("../../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));

vi.mock("../../../src/notification/notifier.js", () => ({
  notifyPlanRetryContext: vi.fn(),
}));

vi.mock("../../../src/claude/model-router.js", () => ({
  configForTaskWithMode: vi.fn(),
}));

import { generatePlan, normalizePhaseIndices } from "../../../src/pipeline/phases/plan-generator.js";
import { loadTemplate } from "../../../src/prompt/template-renderer.js";
import { runClaude, extractJson } from "../../../src/claude/claude-runner.js";
import { configForTaskWithMode } from "../../../src/claude/model-router.js";

describe("plan-generator 템플릿 분기 로직", () => {
  let promptsDir: string;
  const mockLoadTemplate = vi.mocked(loadTemplate);
  const mockRunClaude = vi.mocked(runClaude);
  const mockExtractJson = vi.mocked(extractJson);
  const mockConfigForTaskWithMode = vi.mocked(configForTaskWithMode);

  const validPlan = {
    mode: "code" as const,
    issueNumber: 1,
    title: "Test",
    problemDefinition: "Problem definition",
    requirements: ["Requirement 1"],
    affectedFiles: [] as string[],
    risks: [] as string[],
    phases: [
      {
        index: 0,
        name: "Phase 1",
        description: "Do something",
        targetFiles: [] as string[],
        commitStrategy: "single",
        verificationCriteria: [] as string[],
        dependsOn: [] as number[],
      },
    ],
    verificationPoints: [] as string[],
    stopConditions: [] as string[],
  };

  function makePlanCtx(overrides: object = {}) {
    return {
      issue: { number: 1, title: "Test", body: "test body", labels: [] as string[] },
      repo: { owner: "test", name: "repo" },
      branch: { base: "main", work: "ax/1-test" },
      repoStructure: "",
      claudeConfig: {
        path: "claude",
        model: "claude-opus-4-5",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: [] as string[],
      },
      promptsDir,
      cwd: promptsDir,
      ...overrides,
    };
  }

  beforeEach(() => {
    const testDir = join(tmpdir(), `aq-tmpl-test-${Date.now()}`);
    promptsDir = join(testDir, "prompts");
    mkdirSync(promptsDir, { recursive: true });

    // existsSync 통과를 위해 실제 파일 생성
    writeFileSync(join(promptsDir, "plan-generation.md"), "# main");
    writeFileSync(join(promptsDir, "plan-generation-retry.md"), "# retry");

    vi.clearAllMocks();
    mockConfigForTaskWithMode.mockImplementation((config) => config);
  });

  it("1차 시도 성공 시 plan-generation.md 경로로 loadTemplate 호출되고 retry 템플릿은 로드되지 않는다", async () => {
    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(validPlan),
      durationMs: 500,
    });
    mockExtractJson.mockReturnValue(validPlan);

    await generatePlan(makePlanCtx());

    const calledPaths = mockLoadTemplate.mock.calls.map(([p]) => p as string);
    expect(calledPaths.some((p) => p.endsWith("plan-generation.md"))).toBe(true);
    expect(calledPaths.some((p) => p.endsWith("plan-generation-retry.md"))).toBe(false);
  });

  it("JSON 파싱 실패 후 2차 시도에서 plan-generation-retry.md 경로로 loadTemplate 호출된다", async () => {
    mockRunClaude
      .mockResolvedValueOnce({ success: true, output: "{ invalid json", durationMs: 500 })
      .mockResolvedValueOnce({ success: true, output: JSON.stringify(validPlan), durationMs: 500 });
    mockExtractJson
      .mockImplementationOnce(() => {
        throw new Error("JSON parse failed");
      })
      .mockReturnValueOnce(validPlan);

    await generatePlan(makePlanCtx());

    const calledPaths = mockLoadTemplate.mock.calls.map(([p]) => p as string);
    expect(calledPaths.some((p) => p.endsWith("plan-generation-retry.md"))).toBe(true);
  });

  it("1차 JSON 파싱 실패 후 2차 성공 시 두 템플릿 경로가 모두 loadTemplate에 전달된다", async () => {
    mockRunClaude
      .mockResolvedValueOnce({ success: true, output: "{ invalid json", durationMs: 500 })
      .mockResolvedValueOnce({ success: true, output: JSON.stringify(validPlan), durationMs: 500 });
    mockExtractJson
      .mockImplementationOnce(() => {
        throw new Error("JSON parse failed");
      })
      .mockReturnValueOnce(validPlan);

    await generatePlan(makePlanCtx());

    const calledPaths = mockLoadTemplate.mock.calls.map(([p]) => p as string);
    expect(calledPaths.some((p) => p.endsWith("plan-generation.md"))).toBe(true);
    expect(calledPaths.some((p) => p.endsWith("plan-generation-retry.md"))).toBe(true);
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });
});

describe("normalizePhaseIndices — Claude 1-based 응답 호환", () => {
  const baseMeta = {
    mode: "code" as const,
    issueNumber: 1,
    title: "T",
    problemDefinition: "P",
    requirements: ["R"],
    affectedFiles: [] as string[],
    risks: [] as string[],
  };

  it("1-based phase index + 1-based dependsOn을 0-based 위치로 remap", () => {
    const plan = {
      ...baseMeta,
      phases: [
        { index: 1, name: "P1", description: "", targetFiles: [], dependsOn: [], verificationCriteria: [], commitStrategy: "" },
        { index: 2, name: "P2", description: "", targetFiles: [], dependsOn: [1], verificationCriteria: [], commitStrategy: "" },
      ],
    };
    normalizePhaseIndices(plan as any);
    expect(plan.phases[0].index).toBe(0);
    expect(plan.phases[0].dependsOn).toEqual([]);
    expect(plan.phases[1].index).toBe(1);
    expect(plan.phases[1].dependsOn).toEqual([0]);
  });

  it("0-based phase index + 0-based dependsOn은 그대로 유지", () => {
    const plan = {
      ...baseMeta,
      phases: [
        { index: 0, name: "P1", description: "", targetFiles: [], dependsOn: [], verificationCriteria: [], commitStrategy: "" },
        { index: 1, name: "P2", description: "", targetFiles: [], dependsOn: [0], verificationCriteria: [], commitStrategy: "" },
      ],
    };
    normalizePhaseIndices(plan as any);
    expect(plan.phases[1].dependsOn).toEqual([0]);
  });

  it("dependsOn 미지정 시 빈 배열로 채움", () => {
    const plan = {
      ...baseMeta,
      phases: [
        { index: 1, name: "P1", description: "", targetFiles: [], verificationCriteria: [], commitStrategy: "" } as any,
      ],
    };
    normalizePhaseIndices(plan as any);
    expect(plan.phases[0].dependsOn).toEqual([]);
  });
});
