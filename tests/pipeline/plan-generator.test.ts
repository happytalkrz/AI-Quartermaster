import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock claude-runner before importing
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));

import { generatePlan } from "../../src/pipeline/plan-generator.js";
import { runClaude, extractJson } from "../../src/claude/claude-runner.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("generatePlan", () => {
  let testDir: string;
  let promptsDir: string;
  const mockRunClaude = vi.mocked(runClaude);
  const mockExtractJson = vi.mocked(extractJson);

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-plan-test-${Date.now()}`);
    promptsDir = join(testDir, "prompts");
    mkdirSync(promptsDir, { recursive: true });

    // Write a minimal template
    writeFileSync(
      join(promptsDir, "plan-generation.md"),
      "Generate plan for #{{issue.number}}: {{issue.title}}"
    );

    vi.clearAllMocks();
  });

  it("should generate a valid plan", async () => {
    const mockPlan = {
      issueNumber: 42,
      title: "Add login feature",
      problemDefinition: "Need to add login",
      requirements: ["Login form", "Authentication"],
      affectedFiles: ["src/login.ts"],
      risks: ["Security"],
      phases: [
        {
          index: 0,
          name: "Create login form",
          description: "Build the login form component",
          targetFiles: ["src/login.ts"],
          commitStrategy: "Single commit",
          verificationCriteria: ["Form renders"],
        },
      ],
      verificationPoints: ["All tests pass"],
      stopConditions: ["Auth service unavailable"],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(mockPlan),
      durationMs: 1000,
    });
    mockExtractJson.mockReturnValue(mockPlan);

    const result = await generatePlan({
      issue: {
        number: 42,
        title: "Add login feature",
        body: "Please add login",
        labels: [],
      },
      repo: { owner: "test", name: "repo" },
      branch: { base: "master", work: "ax/42-add-login" },
      repoStructure: "src/\n  index.ts",
      claudeConfig: {
        path: "claude",
        model: "claude-sonnet-4-20250514",
        maxTurns: 50,
        timeout: 600000,
        additionalArgs: [],
      },
      promptsDir,
      cwd: testDir,
    });

    expect(result.issueNumber).toBe(42);
    expect(result.phases).toHaveLength(1);
    expect(result.problemDefinition).toBe("Need to add login");
  });

  it("should throw on Claude failure", async () => {
    mockRunClaude.mockResolvedValue({
      success: false,
      output: "API error",
      durationMs: 500,
    });

    await expect(
      generatePlan({
        issue: { number: 1, title: "Test", body: "", labels: [] },
        repo: { owner: "t", name: "r" },
        branch: { base: "master", work: "ax/1-test" },
        repoStructure: "",
        claudeConfig: {
          path: "claude",
          model: "test",
          maxTurns: 1,
          timeout: 1000,
          additionalArgs: [],
        },
        promptsDir,
        cwd: testDir,
      })
    ).rejects.toThrow("Plan generation failed");
  });

  it("should throw on plan without phases", async () => {
    const badPlan = {
      issueNumber: 1,
      title: "Test",
      problemDefinition: "Test",
      requirements: ["Test"],
      affectedFiles: [],
      risks: [],
      phases: [],
      verificationPoints: [],
      stopConditions: [],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: "{}",
      durationMs: 100,
    });
    mockExtractJson.mockReturnValue(badPlan);

    await expect(
      generatePlan({
        issue: { number: 1, title: "Test", body: "", labels: [] },
        repo: { owner: "t", name: "r" },
        branch: { base: "master", work: "ax/1-test" },
        repoStructure: "",
        claudeConfig: {
          path: "claude",
          model: "test",
          maxTurns: 1,
          timeout: 1000,
          additionalArgs: [],
        },
        promptsDir,
        cwd: testDir,
      })
    ).rejects.toThrow(); // Plan validation or JSON parsing will fail
  });
});
