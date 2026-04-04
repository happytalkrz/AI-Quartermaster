import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listTriggerIssues,
  generateExecutionPlan,
  printExecutionPlan,
  type FetchedIssue,
  type ExecutionPlan,
} from "../../src/pipeline/issue-orchestrator.js";
import * as cliRunner from "../../src/utils/cli-runner.js";
import * as claudeRunner from "../../src/claude/claude-runner.js";
import * as templateRenderer from "../../src/prompt/template-renderer.js";
import * as modelRouter from "../../src/claude/model-router.js";
import type { ClaudeCliConfig } from "../../src/types/config.js";

// Mock dependencies
vi.mock("../../src/utils/cli-runner.js");
vi.mock("../../src/claude/claude-runner.js");
vi.mock("../../src/prompt/template-renderer.js");
vi.mock("../../src/claude/model-router.js");

describe("issue-orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("listTriggerIssues", () => {
    it("should fetch and parse issues successfully", async () => {
      const mockRunCli = vi.mocked(cliRunner.runCli);
      const mockIssuesJson = [
        {
          number: 123,
          title: "Fix bug",
          body: "This is a bug description",
          labels: [{ name: "bug" }, { name: "high-priority" }],
        },
        {
          number: 124,
          title: "Add feature",
          body: "",
          labels: ["enhancement"],
        },
      ];

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockIssuesJson),
        stderr: "",
        exitCode: 0,
      });

      const result = await listTriggerIssues(
        "owner/repo",
        ["bug", "enhancement"],
        "gh"
      );

      expect(mockRunCli).toHaveBeenCalledWith("gh", [
        "issue",
        "list",
        "--repo",
        "owner/repo",
        "--label",
        "bug",
        "--label",
        "enhancement",
        "--state",
        "open",
        "--json",
        "number,title,body,labels",
        "--limit",
        "50",
      ]);

      expect(result).toEqual([
        {
          number: 123,
          title: "Fix bug",
          body: "This is a bug description",
          labels: ["bug", "high-priority"],
        },
        {
          number: 124,
          title: "Add feature",
          body: "",
          labels: ["enhancement"],
        },
      ]);
    });

    it("should handle GitHub CLI failure", async () => {
      const mockRunCli = vi.mocked(cliRunner.runCli);
      mockRunCli.mockResolvedValue({
        stdout: "",
        stderr: "API rate limit exceeded",
        exitCode: 1,
      });

      await expect(
        listTriggerIssues("owner/repo", ["bug"], "gh")
      ).rejects.toThrow("Failed to list issues for owner/repo: API rate limit exceeded");
    });

    it("should handle invalid JSON response", async () => {
      const mockRunCli = vi.mocked(cliRunner.runCli);
      mockRunCli.mockResolvedValue({
        stdout: "invalid json",
        stderr: "",
        exitCode: 0,
      });

      await expect(
        listTriggerIssues("owner/repo", ["bug"], "gh")
      ).rejects.toThrow("Failed to parse gh issue list output: invalid json");
    });

    it("should handle missing body field", async () => {
      const mockRunCli = vi.mocked(cliRunner.runCli);
      const mockIssuesJson = [
        {
          number: 125,
          title: "Issue without body",
          labels: ["bug"],
        },
      ];

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockIssuesJson),
        stderr: "",
        exitCode: 0,
      });

      const result = await listTriggerIssues("owner/repo", ["bug"], "gh");

      expect(result[0].body).toBe("");
    });

    it("should handle mixed label formats", async () => {
      const mockRunCli = vi.mocked(cliRunner.runCli);
      const mockIssuesJson = [
        {
          number: 126,
          title: "Mixed labels",
          body: "test",
          labels: [{ name: "bug" }, "enhancement", { name: "urgent" }],
        },
      ];

      mockRunCli.mockResolvedValue({
        stdout: JSON.stringify(mockIssuesJson),
        stderr: "",
        exitCode: 0,
      });

      const result = await listTriggerIssues("owner/repo", ["bug"], "gh");

      expect(result[0].labels).toEqual(["bug", "enhancement", "urgent"]);
    });
  });

  describe("generateExecutionPlan", () => {
    const mockClaudeConfig: ClaudeCliConfig = {
      path: "claude",
      model: "sonnet",
      maxTurns: 10,
      timeout: 30000,
      additionalArgs: [],
    };

    const mockIssues: FetchedIssue[] = [
      {
        number: 123,
        title: "Fix authentication bug",
        body: "Users cannot log in due to session timeout issue",
        labels: ["bug", "auth"],
      },
      {
        number: 124,
        title: "Add user dashboard",
        body: "Create a comprehensive user dashboard with analytics",
        labels: ["feature", "ui"],
      },
    ];

    it("should generate execution plan successfully", async () => {
      const mockLoadTemplate = vi.mocked(templateRenderer.loadTemplate);
      const mockRenderTemplate = vi.mocked(templateRenderer.renderTemplate);
      const mockConfigForTask = vi.mocked(modelRouter.configForTask);
      const mockRunClaude = vi.mocked(claudeRunner.runClaude);
      const mockExtractJson = vi.mocked(claudeRunner.extractJson);

      const mockTemplate = "Issues to plan: {{issues}}";
      const mockRenderedPrompt = "Issues to plan: - #123: Fix auth...";
      const mockPlanConfig = { ...mockClaudeConfig, model: "opus" };
      const mockClaudeResult = {
        success: true,
        output: '{"totalIssues": 2, "estimatedDuration": "3-5 days", "executionOrder": [[{"issueNumber": 123, "title": "Fix authentication bug", "priority": "high", "dependencies": [], "estimatedPhases": 3}], [{"issueNumber": 124, "title": "Add user dashboard", "priority": "medium", "dependencies": [123], "estimatedPhases": 5}]]}',
        durationMs: 5000,
      };
      const mockParsedPlan = {
        totalIssues: 2,
        estimatedDuration: "3-5 days",
        executionOrder: [
          [
            {
              issueNumber: 123,
              title: "Fix authentication bug",
              priority: "high" as const,
              dependencies: [],
              estimatedPhases: 3,
            },
          ],
          [
            {
              issueNumber: 124,
              title: "Add user dashboard",
              priority: "medium" as const,
              dependencies: [123],
              estimatedPhases: 5,
            },
          ],
        ],
      };

      mockLoadTemplate.mockReturnValue(mockTemplate);
      mockRenderTemplate.mockReturnValue(mockRenderedPrompt);
      mockConfigForTask.mockReturnValue(mockPlanConfig);
      mockRunClaude.mockResolvedValue(mockClaudeResult);
      mockExtractJson.mockReturnValue(mockParsedPlan);

      const result = await generateExecutionPlan(
        mockIssues,
        mockClaudeConfig,
        "/test/cwd",
        "/test/aq-root"
      );

      expect(mockLoadTemplate).toHaveBeenCalledWith("/test/aq-root/prompts/issue-orchestration.md");
      expect(mockRenderTemplate).toHaveBeenCalledWith(mockTemplate, {
        issues: "- #123: Fix authentication bug\n  Body: Users cannot log in due to session timeout issue\n  Labels: bug, auth\n\n- #124: Add user dashboard\n  Body: Create a comprehensive user dashboard with analytics\n  Labels: feature, ui",
      });
      expect(mockConfigForTask).toHaveBeenCalledWith(mockClaudeConfig, "plan");
      expect(mockRunClaude).toHaveBeenCalledWith({
        prompt: mockRenderedPrompt,
        cwd: "/test/cwd",
        config: mockPlanConfig,
      });
      expect(mockExtractJson).toHaveBeenCalledWith(mockClaudeResult.output);

      expect(result).toEqual({
        repo: "",
        totalIssues: 2,
        executionOrder: mockParsedPlan.executionOrder,
        estimatedDuration: "3-5 days",
      });
    });

    it("should handle Claude failure", async () => {
      const mockLoadTemplate = vi.mocked(templateRenderer.loadTemplate);
      const mockRenderTemplate = vi.mocked(templateRenderer.renderTemplate);
      const mockConfigForTask = vi.mocked(modelRouter.configForTask);
      const mockRunClaude = vi.mocked(claudeRunner.runClaude);

      mockLoadTemplate.mockReturnValue("template");
      mockRenderTemplate.mockReturnValue("prompt");
      mockConfigForTask.mockReturnValue(mockClaudeConfig);
      mockRunClaude.mockResolvedValue({
        success: false,
        output: "Claude execution failed: timeout",
        durationMs: 30000,
      });

      await expect(
        generateExecutionPlan(mockIssues, mockClaudeConfig, "/test/cwd", "/test/aq-root")
      ).rejects.toThrow("Claude failed to generate execution plan: Claude execution failed: timeout");
    });

    it("should handle long issue body truncation", async () => {
      const mockLoadTemplate = vi.mocked(templateRenderer.loadTemplate);
      const mockRenderTemplate = vi.mocked(templateRenderer.renderTemplate);
      const mockConfigForTask = vi.mocked(modelRouter.configForTask);
      const mockRunClaude = vi.mocked(claudeRunner.runClaude);
      const mockExtractJson = vi.mocked(claudeRunner.extractJson);

      const longBodyIssue: FetchedIssue = {
        number: 999,
        title: "Long description issue",
        body: "A".repeat(250) + "B".repeat(50), // 300 chars total
        labels: ["feature"],
      };

      mockLoadTemplate.mockReturnValue("{{issues}}");
      mockRenderTemplate.mockReturnValue("rendered prompt");
      mockConfigForTask.mockReturnValue(mockClaudeConfig);
      mockRunClaude.mockResolvedValue({
        success: true,
        output: '{"totalIssues": 1, "estimatedDuration": "1 day", "executionOrder": []}',
        durationMs: 1000,
      });
      mockExtractJson.mockReturnValue({
        totalIssues: 1,
        estimatedDuration: "1 day",
        executionOrder: [],
      });

      await generateExecutionPlan([longBodyIssue], mockClaudeConfig, "/test/cwd", "/test/aq-root");

      const renderCall = mockRenderTemplate.mock.calls[0];
      const issuesSummary = renderCall[1].issues as string;

      // Check that the issues summary is passed correctly to template renderer
      expect(renderCall[0]).toBe("{{issues}}");

      // Check that long body is truncated to 200 chars + "..."
      expect(issuesSummary).toContain("A".repeat(200) + "...");

      // Verify the expected format - body should be truncated at 200 chars
      const expectedBody = "A".repeat(200) + "...";
      expect(issuesSummary).toBe(
        "- #999: Long description issue\n  Body: " + expectedBody + "\n  Labels: feature"
      );

      // Verify that the "B" characters from the original long body are not present
      // (excluding the "B" in "Body:" label)
      const bodyContent = issuesSummary.split("Body: ")[1].split("\n")[0];
      expect(bodyContent).not.toContain("B"); // The "B" part should be truncated
    });
  });

  describe("printExecutionPlan", () => {
    let mockConsoleLog: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("should print execution plan with correct formatting", () => {
      const mockPlan: ExecutionPlan = {
        repo: "owner/test-repo",
        totalIssues: 3,
        estimatedDuration: "5-7 days",
        executionOrder: [
          [
            {
              issueNumber: 123,
              title: "Fix critical auth bug",
              priority: "high",
              dependencies: [],
              estimatedPhases: 2,
            },
            {
              issueNumber: 124,
              title: "Update user interface design",
              priority: "medium",
              dependencies: [],
              estimatedPhases: 4,
            },
          ],
          [
            {
              issueNumber: 125,
              title: "Add comprehensive analytics dashboard",
              priority: "low",
              dependencies: [123, 124],
              estimatedPhases: 6,
            },
          ],
        ],
      };

      printExecutionPlan(mockPlan);

      // Check header
      expect(mockConsoleLog).toHaveBeenCalledWith("\n실행 계획 — owner/test-repo");
      expect(mockConsoleLog).toHaveBeenCalledWith("총 이슈: 3  예상 기간: 5-7 days\n");

      // Check batch headers
      expect(mockConsoleLog).toHaveBeenCalledWith("── 배치 1 (2개 병렬 실행 가능) ──");
      expect(mockConsoleLog).toHaveBeenCalledWith("── 배치 2 (1개 병렬 실행 가능) ──");

      // Check column headers are printed
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("이슈")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("제목")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("우선순위")
      );

      // Check issue rows
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("#123")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Fix critical auth bug")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("#125")
      );
    });

    it("should handle issues without dependencies", () => {
      const mockPlan: ExecutionPlan = {
        repo: "test/repo",
        totalIssues: 1,
        estimatedDuration: "1 day",
        executionOrder: [
          [
            {
              issueNumber: 100,
              title: "Simple task",
              priority: "medium",
              dependencies: [],
              estimatedPhases: 1,
            },
          ],
        ],
      };

      printExecutionPlan(mockPlan);

      // Find calls that contain the dependencies column
      const dependencyCalls = mockConsoleLog.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('-')
      );

      // Should show "-" for no dependencies
      expect(dependencyCalls.length).toBeGreaterThan(0);
    });

    it("should handle issues with multiple dependencies", () => {
      const mockPlan: ExecutionPlan = {
        repo: "test/repo",
        totalIssues: 1,
        estimatedDuration: "1 day",
        executionOrder: [
          [
            {
              issueNumber: 200,
              title: "Complex task",
              priority: "high",
              dependencies: [100, 150, 175],
              estimatedPhases: 3,
            },
          ],
        ],
      };

      printExecutionPlan(mockPlan);

      // Check that dependencies are formatted correctly
      const dependencyCall = mockConsoleLog.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('#100, #150, #175')
      );

      expect(dependencyCall).toBeDefined();
    });

    it("should truncate long titles", () => {
      const mockPlan: ExecutionPlan = {
        repo: "test/repo",
        totalIssues: 1,
        estimatedDuration: "1 day",
        executionOrder: [
          [
            {
              issueNumber: 300,
              title: "This is an extremely long title that should be truncated to fit the column width properly",
              priority: "low",
              dependencies: [],
              estimatedPhases: 2,
            },
          ],
        ],
      };

      printExecutionPlan(mockPlan);

      // Find the call with the truncated title
      const titleCall = mockConsoleLog.mock.calls.find(call =>
        typeof call[0] === 'string' &&
        call[0].includes('#300') &&
        call[0].length < 200 // Should be truncated
      );

      expect(titleCall).toBeDefined();
    });

    it("should display correct priority icons", () => {
      const mockPlan: ExecutionPlan = {
        repo: "test/repo",
        totalIssues: 3,
        estimatedDuration: "2 days",
        executionOrder: [
          [
            {
              issueNumber: 401,
              title: "High priority",
              priority: "high",
              dependencies: [],
              estimatedPhases: 1,
            },
            {
              issueNumber: 402,
              title: "Medium priority",
              priority: "medium",
              dependencies: [],
              estimatedPhases: 1,
            },
            {
              issueNumber: 403,
              title: "Low priority",
              priority: "low",
              dependencies: [],
              estimatedPhases: 1,
            },
          ],
        ],
      };

      printExecutionPlan(mockPlan);

      // Check that priority icons are used
      const highPriorityCall = mockConsoleLog.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('🔴')
      );
      const mediumPriorityCall = mockConsoleLog.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('🟡')
      );
      const lowPriorityCall = mockConsoleLog.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('🟢')
      );

      expect(highPriorityCall).toBeDefined();
      expect(mediumPriorityCall).toBeDefined();
      expect(lowPriorityCall).toBeDefined();
    });
  });
});