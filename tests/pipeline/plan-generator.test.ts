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
      mode: "code",
      issueNumber: 1,
      title: "Test",
      problemDefinition: "Test",
      requirements: ["Test"],
      affectedFiles: [],
      risks: [],
      phases: [], // Empty phases should trigger validation error
      verificationPoints: [],
      stopConditions: [],
    };

    // Return consistent valid JSON that will pass JSON parsing but fail validation
    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(badPlan),
      durationMs: 100,
    });

    // Mock extractJson to return the badPlan consistently on all calls
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
    ).rejects.toThrow("Plan must have at least one phase");
  });

  it("should retry on first Claude failure then succeed", async () => {
    const validPlan = {
      mode: "code",
      issueNumber: 123,
      title: "Fix bug",
      problemDefinition: "Bug needs fixing",
      requirements: ["Fix the bug"],
      affectedFiles: ["src/bug.ts"],
      risks: ["Breaking change"],
      phases: [
        {
          index: 0,
          name: "Fix bug",
          description: "Apply the fix",
          targetFiles: ["src/bug.ts"],
          commitStrategy: "Single commit",
          verificationCriteria: ["Tests pass"],
        },
      ],
      verificationPoints: ["Bug is fixed"],
      stopConditions: ["Service down"],
    };

    // First call fails, second succeeds
    mockRunClaude
      .mockResolvedValueOnce({
        success: false,
        output: "API timeout",
        durationMs: 500,
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify(validPlan),
        durationMs: 1000,
      });
    mockExtractJson.mockReturnValue(validPlan);

    const result = await generatePlan({
      issue: { number: 123, title: "Fix bug", body: "There's a bug", labels: [] },
      repo: { owner: "test", name: "repo" },
      branch: { base: "main", work: "ax/123-fix-bug" },
      repoStructure: "src/",
      claudeConfig: {
        path: "claude",
        model: "test",
        maxTurns: 5,
        timeout: 5000,
        additionalArgs: [],
      },
      promptsDir,
      cwd: testDir,
    });

    expect(mockRunClaude).toHaveBeenCalledTimes(2);
    expect(result.issueNumber).toBe(123);
    expect(result.mode).toBe("code");
  });

  it("should fail after max retries on repeated Claude failures", async () => {
    // All attempts fail
    mockRunClaude.mockResolvedValue({
      success: false,
      output: "Persistent API error",
      durationMs: 500,
    });

    await expect(
      generatePlan({
        issue: { number: 456, title: "Test", body: "", labels: [] },
        repo: { owner: "test", name: "repo" },
        branch: { base: "main", work: "ax/456-test" },
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
    ).rejects.toThrow("Plan generation failed after 2 attempts");

    expect(mockRunClaude).toHaveBeenCalledTimes(2); // maxRetries = 2
  });

  it("should retry on JSON parsing failure then succeed", async () => {
    const validPlan = {
      mode: "content",
      issueNumber: 789,
      title: "Update docs",
      problemDefinition: "Docs need update",
      requirements: ["Update README"],
      affectedFiles: ["README.md"],
      risks: ["Confusion"],
      phases: [
        {
          index: 0,
          name: "Update README",
          description: "Add new section",
          targetFiles: ["README.md"],
          commitStrategy: "Direct commit",
          verificationCriteria: ["Docs are clear"],
        },
      ],
      verificationPoints: ["Documentation complete"],
      stopConditions: [],
    };

    // First call returns malformed JSON, second call succeeds
    mockRunClaude
      .mockResolvedValueOnce({
        success: true,
        output: "{ invalid json: malformed",
        durationMs: 1000,
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify(validPlan),
        durationMs: 1000,
      });

    // First extractJson call throws, second succeeds
    mockExtractJson
      .mockImplementationOnce(() => {
        throw new Error("JSON parsing failed");
      })
      .mockReturnValueOnce(validPlan);

    const result = await generatePlan({
      issue: { number: 789, title: "Update docs", body: "Docs outdated", labels: [] },
      repo: { owner: "test", name: "repo" },
      branch: { base: "main", work: "ax/789-docs" },
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
    });

    expect(mockRunClaude).toHaveBeenCalledTimes(2);
    expect(result.mode).toBe("content");
    expect(result.title).toBe("Update docs");
  });

  it("should fail after max retries on repeated JSON parsing failures", async () => {
    // All attempts return invalid JSON
    mockRunClaude.mockResolvedValue({
      success: true,
      output: "{ completely: broken json",
      durationMs: 1000,
    });

    mockExtractJson.mockImplementation(() => {
      throw new Error("JSON parsing failed");
    });

    await expect(
      generatePlan({
        issue: { number: 999, title: "Test", body: "", labels: [] },
        repo: { owner: "test", name: "repo" },
        branch: { base: "main", work: "ax/999-test" },
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
    ).rejects.toThrow("Plan generation failed: JSON 파싱 실패");

    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it("should throw on plan without problemDefinition", async () => {
    const badPlan = {
      mode: "code",
      issueNumber: 1,
      title: "Test",
      problemDefinition: "", // Empty problem definition
      requirements: ["Test"],
      affectedFiles: [],
      risks: [],
      phases: [
        {
          index: 0,
          name: "Test phase",
          description: "Test description",
          targetFiles: [],
          commitStrategy: "Single",
          verificationCriteria: [],
        },
      ],
      verificationPoints: [],
      stopConditions: [],
    };

    // Clear previous mocks and set new ones
    vi.clearAllMocks();
    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(badPlan),
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
    ).rejects.toThrow("Plan must have a problem definition");
  });

  it("should throw on plan without requirements", async () => {
    const badPlan = {
      mode: "code",
      issueNumber: 1,
      title: "Test",
      problemDefinition: "Test problem",
      requirements: [], // Empty requirements
      affectedFiles: [],
      risks: [],
      phases: [
        {
          index: 0,
          name: "Test phase",
          description: "Test description",
          targetFiles: [],
          commitStrategy: "Single",
          verificationCriteria: [],
        },
      ],
      verificationPoints: [],
      stopConditions: [],
    };

    // Clear previous mocks and set new ones
    vi.clearAllMocks();
    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(badPlan),
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
    ).rejects.toThrow("Plan must have requirements");
  });

  it("should handle different issue types and modes", async () => {
    const contentPlan = {
      mode: "content",
      issueNumber: 555,
      title: "Write blog post",
      problemDefinition: "Need new blog content",
      requirements: ["Research topic", "Write draft", "Review"],
      affectedFiles: ["blog/new-post.md"],
      risks: ["Content quality"],
      phases: [
        {
          index: 0,
          name: "Research",
          description: "Research the topic",
          targetFiles: ["blog/research.md"],
          commitStrategy: "Draft commit",
          verificationCriteria: ["Research complete"],
        },
        {
          index: 1,
          name: "Write post",
          description: "Create the blog post",
          targetFiles: ["blog/new-post.md"],
          commitStrategy: "Final commit",
          verificationCriteria: ["Post written", "Grammar checked"],
          dependsOn: [0],
        },
      ],
      verificationPoints: ["Blog post published"],
      stopConditions: ["Topic changed"],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(contentPlan),
      durationMs: 1500,
    });
    mockExtractJson.mockReturnValue(contentPlan);

    const result = await generatePlan({
      issue: {
        number: 555,
        title: "Write blog post",
        body: "Need to write about our new feature",
        labels: ["content", "blog"]
      },
      repo: { owner: "company", name: "blog" },
      branch: { base: "main", work: "ax/555-blog-post" },
      repoStructure: "blog/\n  index.md\n  posts/",
      claudeConfig: {
        path: "claude",
        model: "claude-sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: ["--verbose"],
      },
      promptsDir,
      cwd: testDir,
      modeHint: "This is a content creation task",
      maxPhases: 5,
      sensitivePaths: "config/secrets.yml",
    });

    expect(result.mode).toBe("content");
    expect(result.phases).toHaveLength(2);
    expect(result.phases[1].dependsOn).toEqual([0]);
    expect(result.issueNumber).toBe(555);
  });

  it("should normalize phase indices and fill missing arrays", async () => {
    const planWithMissingFields = {
      mode: "code",
      issueNumber: 333,
      title: "Fix validation",
      problemDefinition: "Validation is broken",
      requirements: ["Fix validator"],
      affectedFiles: ["src/validator.ts"],
      risks: ["Data corruption"],
      phases: [
        {
          // Missing index, targetFiles, verificationCriteria, dependsOn
          name: "Fix validator",
          description: "Update validation logic",
          commitStrategy: "Single commit",
        },
        {
          // Missing arrays
          index: 999, // Should be corrected to 1
          name: "Add tests",
          description: "Add validation tests",
          commitStrategy: "Test commit",
        },
      ],
      verificationPoints: ["Validation works"],
      stopConditions: [],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(planWithMissingFields),
      durationMs: 1000,
    });
    mockExtractJson.mockReturnValue(planWithMissingFields);

    const result = await generatePlan({
      issue: { number: 333, title: "Fix validation", body: "", labels: [] },
      repo: { owner: "test", name: "repo" },
      branch: { base: "main", work: "ax/333-validation" },
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
    });

    // Verify indices are normalized
    expect(result.phases[0].index).toBe(0);
    expect(result.phases[1].index).toBe(1);

    // Verify missing arrays are filled
    expect(result.phases[0].targetFiles).toEqual([]);
    expect(result.phases[0].verificationCriteria).toEqual([]);
    expect(result.phases[0].dependsOn).toEqual([]);
    expect(result.phases[1].targetFiles).toEqual([]);
    expect(result.phases[1].verificationCriteria).toEqual([]);
    expect(result.phases[1].dependsOn).toEqual([]);
  });
});
