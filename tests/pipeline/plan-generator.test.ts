import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock claude-runner before importing
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
  extractJson: vi.fn(),
}));

// Mock notifier before importing
vi.mock("../../src/notification/notifier.js", () => ({
  notifyPlanRetryContext: vi.fn(),
}));

import { generatePlan, collectContextualizationInfo } from "../../src/pipeline/plan-generator.js";
import { runClaude, extractJson } from "../../src/claude/claude-runner.js";
import { notifyPlanRetryContext } from "../../src/notification/notifier.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("generatePlan", () => {
  let testDir: string;
  let promptsDir: string;
  const mockRunClaude = vi.mocked(runClaude);
  const mockExtractJson = vi.mocked(extractJson);
  const mockNotifyPlanRetryContext = vi.mocked(notifyPlanRetryContext);

  beforeEach(() => {
    testDir = join(tmpdir(), `aq-plan-test-${Date.now()}`);
    promptsDir = join(testDir, "prompts");
    mkdirSync(promptsDir, { recursive: true });

    // Write a minimal template
    writeFileSync(
      join(promptsDir, "plan-generation.md"),
      "Generate plan for #{{issue.number}}: {{issue.title}}"
    );

    // Reset all mocks and set defaults
    vi.clearAllMocks();

    // Ensure extractJson is properly mocked by default
    mockExtractJson.mockImplementation((text: string) => {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("JSON parsing failed");
      }
    });
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

    expect(result.plan.issueNumber).toBe(42);
    expect(result.plan.phases).toHaveLength(1);
    expect(result.plan.problemDefinition).toBe("Need to add login");
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

  it("should handle template rendering with various issue data", async () => {
    const mockPlan = {
      mode: "code",
      issueNumber: 111,
      title: "Template Test",
      problemDefinition: "Test template rendering",
      requirements: ["Proper rendering"],
      affectedFiles: ["src/template.ts"],
      risks: ["Rendering failure"],
      phases: [
        {
          index: 0,
          name: "Template phase",
          description: "Test template",
          targetFiles: ["src/template.ts"],
          commitStrategy: "Single",
          verificationCriteria: ["Template works"],
        },
      ],
      verificationPoints: ["Rendering successful"],
      stopConditions: ["Template error"],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(mockPlan),
      durationMs: 100,
    });
    mockExtractJson.mockReturnValue(mockPlan);

    const result = await generatePlan({
      issue: {
        number: 111,
        title: "Template Test with Special chars: <>\"'&",
        body: "Body with\nmultiple\nlines",
        labels: ["template", "test"],
      },
      repo: { owner: "test-org", name: "test-repo" },
      branch: { base: "master", work: "ax/111-template" },
      repoStructure: "Complex\n  Structure\n    With\n      Indentation",
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

    expect(result.plan.title).toBe("Template Test");
    expect(result.plan.issueNumber).toBe(111);
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
    expect(result.plan.issueNumber).toBe(123);
    expect(result.plan.mode).toBe("code");
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
    expect(result.plan.mode).toBe("content");
    expect(result.plan.title).toBe("Update docs");
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

  it("should use JSON schema for structured output", async () => {
    const schemaBasedPlan = {
      mode: "content",
      issueNumber: 222,
      title: "Schema test",
      problemDefinition: "Test JSON schema validation",
      requirements: ["Valid schema", "Proper structure"],
      affectedFiles: ["docs/schema.json"],
      risks: ["Schema mismatch"],
      phases: [
        {
          index: 0,
          name: "Schema validation",
          description: "Validate against JSON schema",
          targetFiles: ["docs/schema.json"],
          commitStrategy: "Schema commit",
          verificationCriteria: ["Schema valid", "Output structured"],
        },
      ],
      verificationPoints: ["Schema compliance"],
      stopConditions: ["Invalid structure"],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(schemaBasedPlan),
      durationMs: 1200,
    });
    mockExtractJson.mockReturnValue(schemaBasedPlan);

    const result = await generatePlan({
      issue: { number: 222, title: "Schema test", body: "Test JSON schema", labels: ["schema"] },
      repo: { owner: "test", name: "schema-repo" },
      branch: { base: "main", work: "ax/222-schema" },
      repoStructure: "docs/\n  schema.json",
      claudeConfig: {
        path: "claude",
        model: "claude-haiku",
        maxTurns: 3,
        timeout: 10000,
        additionalArgs: ["--json-mode"],
      },
      promptsDir,
      cwd: testDir,
    });

    // Verify schema compliance
    expect(result.plan.mode).toBe("content");
    expect(result.plan.phases[0].verificationCriteria).toContain("Schema valid");
    expect(typeof result.plan.issueNumber).toBe("number");
  });

  it("should handle large and complex issue descriptions", async () => {
    const complexPlan = {
      mode: "code",
      issueNumber: 333,
      title: "Large complex issue",
      problemDefinition: "Complex multi-part problem requiring detailed analysis",
      requirements: [
        "Requirement 1: Database optimization",
        "Requirement 2: API enhancement",
        "Requirement 3: Frontend updates",
        "Requirement 4: Documentation updates",
        "Requirement 5: Test coverage improvement"
      ],
      affectedFiles: [
        "src/database/optimizer.ts",
        "src/api/v2/endpoints.ts",
        "src/frontend/components/*.tsx",
        "docs/api.md",
        "tests/**/*.test.ts"
      ],
      risks: [
        "Performance regression",
        "Breaking API changes",
        "Database migration complexity",
        "Frontend compatibility issues"
      ],
      phases: [
        {
          index: 0,
          name: "Database optimization",
          description: "Optimize database queries and indexes",
          targetFiles: ["src/database/optimizer.ts", "migrations/"],
          commitStrategy: "Separate commits per optimization",
          verificationCriteria: ["Query performance improved", "No data loss", "Tests pass"],
        },
        {
          index: 1,
          name: "API enhancements",
          description: "Add new API endpoints and improve existing ones",
          targetFiles: ["src/api/v2/endpoints.ts"],
          commitStrategy: "Feature branch merge",
          verificationCriteria: ["API tests pass", "Backward compatibility", "Documentation updated"],
          dependsOn: [0],
        },
      ],
      verificationPoints: [
        "All optimizations complete",
        "API functionality verified",
        "Frontend integration tested",
        "Documentation up to date"
      ],
      stopConditions: [
        "Performance regression detected",
        "API breaking changes found",
        "Critical security vulnerability"
      ],
    };

    mockRunClaude.mockResolvedValue({
      success: true,
      output: JSON.stringify(complexPlan),
      durationMs: 3000,
    });
    mockExtractJson.mockReturnValue(complexPlan);

    const longIssueBody = `
# Complex Issue Description

This is a comprehensive issue that involves multiple components:

## Background
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Problem Statement
1. Database queries are slow
2. API needs new endpoints
3. Frontend components need updates
4. Documentation is outdated

## Acceptance Criteria
- [ ] Database performance improved by 50%
- [ ] New API endpoints implemented
- [ ] Frontend components updated
- [ ] Documentation reflects all changes

## Technical Details
\`\`\`sql
SELECT * FROM large_table WHERE complex_condition;
\`\`\`

## Related Issues
Fixes #100, #200, #300
`;

    const result = await generatePlan({
      issue: {
        number: 333,
        title: "Complex multi-component enhancement",
        body: longIssueBody,
        labels: ["enhancement", "performance", "api", "frontend", "documentation"],
      },
      repo: { owner: "enterprise", name: "platform" },
      branch: { base: "develop", work: "ax/333-complex-enhancement" },
      repoStructure: `
src/
  database/
    optimizer.ts
    migrations/
  api/
    v1/
    v2/
      endpoints.ts
  frontend/
    components/
      Dashboard.tsx
      UserList.tsx
docs/
  api.md
  deployment.md
tests/
  unit/
  integration/
`,
      claudeConfig: {
        path: "claude",
        model: "claude-opus",
        maxTurns: 30,
        timeout: 120000,
        additionalArgs: ["--verbose", "--enable-agents"],
      },
      promptsDir,
      cwd: testDir,
      maxPhases: 8,
      sensitivePaths: "src/database/migrations/,config/production.yml",
      modeHint: "This is a complex enterprise-level enhancement",
    });

    expect(result.plan.requirements).toHaveLength(5);
    expect(result.plan.affectedFiles.length).toBeGreaterThan(3);
    expect(result.plan.risks).toContain("Performance regression");
    expect(result.plan.phases).toHaveLength(2);
    expect(result.plan.phases[1].dependsOn).toEqual([0]);
    expect(result.plan.verificationPoints.length).toBeGreaterThan(2);
    expect(result.plan.stopConditions).toContain("Performance regression detected");
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

    expect(result.plan.mode).toBe("content");
    expect(result.plan.phases).toHaveLength(2);
    expect(result.plan.phases[1].dependsOn).toEqual([0]);
    expect(result.plan.issueNumber).toBe(555);
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
    expect(result.plan.phases[0].index).toBe(0);
    expect(result.plan.phases[1].index).toBe(1);

    // Verify missing arrays are filled
    expect(result.plan.phases[0].targetFiles).toEqual([]);
    expect(result.plan.phases[0].verificationCriteria).toEqual([]);
    expect(result.plan.phases[0].dependsOn).toEqual([]);
    expect(result.plan.phases[1].targetFiles).toEqual([]);
    expect(result.plan.phases[1].verificationCriteria).toEqual([]);
    expect(result.plan.phases[1].dependsOn).toEqual([]);
  });

  // Phase 6: 재시도 로직 테스트 케이스 추가
  describe("plan retry logic with contextualization", () => {
    beforeEach(() => {
      // Create a dummy retry template
      writeFileSync(
        join(promptsDir, "plan-generation-retry.md"),
        "Retry plan generation for #{{issue.number}}: {{issue.title}}\n\nContext: {{context}}\nRetry: {{retry}}"
      );

      // Reset notification mock
      mockNotifyPlanRetryContext.mockClear();
    });

    it("should collect contextualization info and retry successfully", async () => {
      // Create mock files for context collection
      const mockFilePath = join(testDir, "src", "test.ts");
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(mockFilePath, `
        export interface TestInterface {
          id: string;
          name: string;
        }

        export async function testFunction(param: string): Promise<TestInterface> {
          return { id: "1", name: param };
        }

        import { someUtil } from "./utils.js";
        export { testFunction as default };
      `);

      const validPlan = {
        mode: "code",
        issueNumber: 123,
        title: "Test with context",
        problemDefinition: "Test contextualization",
        requirements: ["Context collection"],
        affectedFiles: ["src/test.ts"],
        risks: ["Test risk"],
        phases: [
          {
            index: 0,
            name: "Test phase",
            description: "Test with context",
            targetFiles: ["src/test.ts"],
            commitStrategy: "Single commit",
            verificationCriteria: ["Tests pass"],
          },
        ],
        verificationPoints: ["Context collected"],
        stopConditions: [],
      };

      // First call fails, second succeeds
      mockRunClaude
        .mockResolvedValueOnce({
          success: false,
          output: "API failure",
          durationMs: 500,
        })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(validPlan),
          durationMs: 1000,
        });
      mockExtractJson.mockReturnValue(validPlan);

      const result = await generatePlan({
        issue: {
          number: 123,
          title: "Test with context collection",
          body: "Please fix src/test.ts file",
          labels: [],
        },
        repo: { owner: "test", name: "repo" },
        branch: { base: "main", work: "ax/123-context" },
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
      expect(mockNotifyPlanRetryContext).toHaveBeenCalledTimes(1);
      expect(result.plan.issueNumber).toBe(123);

      // Verify context collection notification was called with proper structure
      const notifyCall = mockNotifyPlanRetryContext.mock.calls[0];
      expect(notifyCall[0]).toBe("test/repo"); // repo
      expect(notifyCall[1]).toBe(123); // issue number
      expect(notifyCall[2]).toMatchObject({
        currentAttempt: expect.any(Number),
        maxRetries: 2,
        canRetry: true,
        generationHistory: expect.arrayContaining([
          expect.objectContaining({
            success: false,
            error: expect.stringContaining("API failure"),
            errorCategory: "CLI_CRASH",
            attempt: 1,
          }),
        ]),
      });

      // Verify contextualization info was collected
      const contextInfo = notifyCall[3];
      expect(contextInfo).toBeDefined();
      expect(contextInfo.functionSignatures["src/test.ts"]).toBeDefined();
      expect(contextInfo.importRelations["src/test.ts"]).toBeDefined();
      expect(contextInfo.typeDefinitions["src/test.ts"]).toBeDefined();
    });

    it("should fail after max retries with context collection", async () => {
      // Create mock file
      const mockFilePath = join(testDir, "src", "failing.ts");
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(mockFilePath, `
        export function failingFunction(): void {
          console.log("This will fail");
        }
      `);

      // All attempts fail
      mockRunClaude.mockResolvedValue({
        success: false,
        output: "Persistent API error",
        durationMs: 500,
      });

      await expect(
        generatePlan({
          issue: {
            number: 456,
            title: "Failing test",
            body: "Fix src/failing.ts",
            labels: [],
          },
          repo: { owner: "test", name: "repo" },
          branch: { base: "main", work: "ax/456-fail" },
          repoStructure: "src/",
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
      expect(mockNotifyPlanRetryContext).toHaveBeenCalledTimes(1); // Called once before second attempt

      // Verify that context collection was attempted
      const notifyCall = mockNotifyPlanRetryContext.mock.calls[0];
      expect(notifyCall[2].generationHistory).toHaveLength(1);
      expect(notifyCall[2].generationHistory[0].success).toBe(false);
    });

    it("should collect contextualization info correctly for TypeScript files", async () => {
      // Create a complex TypeScript file for testing
      const complexFilePath = join(testDir, "src", "complex.ts");
      mkdirSync(join(testDir, "src"), { recursive: true });
      writeFileSync(complexFilePath, `
        import { readFile } from "fs/promises";
        import type { Config } from "./config.js";

        export interface User {
          id: number;
          name: string;
          email: string;
        }

        export type UserStatus = "active" | "inactive" | "pending";

        export enum Permission {
          READ = "read",
          WRITE = "write",
          ADMIN = "admin",
        }

        export async function getUserById(id: number): Promise<User | null> {
          // Implementation here
          return null;
        }

        export const validateUser = (user: User): boolean => {
          return user.id > 0 && user.email.includes("@");
        };

        export class UserManager {
          async createUser(data: Partial<User>): Promise<User> {
            // Implementation
            return data as User;
          }
        }

        export default UserManager;
      `);

      const contextInfo = collectContextualizationInfo(["src/complex.ts"], testDir);

      // Verify function signatures
      expect(contextInfo.functionSignatures["src/complex.ts"]).toEqual(
        expect.arrayContaining([
          expect.stringContaining("getUserById"),
          expect.stringContaining("validateUser"),
          expect.stringContaining("createUser"),
        ])
      );

      // Verify import relations
      expect(contextInfo.importRelations["src/complex.ts"].imports).toEqual(
        expect.arrayContaining([
          expect.stringContaining("fs/promises"),
          expect.stringContaining("config.js"),
        ])
      );

      expect(contextInfo.importRelations["src/complex.ts"].exports).toEqual(
        expect.arrayContaining([
          expect.stringContaining("export"),
        ])
      );

      // Verify type definitions
      expect(contextInfo.typeDefinitions["src/complex.ts"]).toEqual(
        expect.arrayContaining([
          expect.stringContaining("interface User"),
          expect.stringContaining("type UserStatus"),
          expect.stringContaining("enum Permission"),
          expect.stringContaining("class UserManager"),
        ])
      );
    });

    it("should handle context collection for non-existent files gracefully", async () => {
      const contextInfo = collectContextualizationInfo(["src/nonexistent.ts", "invalid/path.js"], testDir);

      // Should return empty structures for non-existent files
      expect(contextInfo.functionSignatures).toEqual({});
      expect(contextInfo.importRelations).toEqual({});
      expect(contextInfo.typeDefinitions).toEqual({});
    });

    it("should handle context collection for non-TypeScript files gracefully", async () => {
      // Create non-TS files
      mkdirSync(join(testDir, "docs"), { recursive: true });
      writeFileSync(join(testDir, "docs", "README.md"), "# Test README");
      writeFileSync(join(testDir, "config.json"), '{"test": true}');

      const contextInfo = collectContextualizationInfo(["docs/README.md", "config.json"], testDir);

      // Should skip non-TS files
      expect(contextInfo.functionSignatures).toEqual({});
      expect(contextInfo.importRelations).toEqual({});
      expect(contextInfo.typeDefinitions).toEqual({});
    });

    it("should use retry template when available", async () => {
      const validPlan = {
        mode: "code",
        issueNumber: 789,
        title: "Retry template test",
        problemDefinition: "Test retry template usage",
        requirements: ["Use retry template"],
        affectedFiles: ["src/retry.ts"],
        risks: [],
        phases: [
          {
            index: 0,
            name: "Retry phase",
            description: "Test retry template",
            targetFiles: ["src/retry.ts"],
            commitStrategy: "Single commit",
            verificationCriteria: ["Template used"],
          },
        ],
        verificationPoints: ["Retry successful"],
        stopConditions: [],
      };

      // First call fails, second succeeds
      mockRunClaude
        .mockResolvedValueOnce({
          success: false,
          output: "Initial failure",
          durationMs: 500,
        })
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(validPlan),
          durationMs: 1000,
        });
      mockExtractJson.mockReturnValue(validPlan);

      const result = await generatePlan({
        issue: {
          number: 789,
          title: "Retry template test",
          body: "Test retry template functionality",
          labels: [],
        },
        repo: { owner: "test", name: "repo" },
        branch: { base: "main", work: "ax/789-retry-template" },
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
      expect(result.plan.issueNumber).toBe(789);

      // Verify that the second call used the retry template
      const secondCall = mockRunClaude.mock.calls[1];
      const promptUsed = secondCall[0].prompt;
      expect(promptUsed).toContain("Retry plan generation");
      expect(promptUsed).toContain("Context:");
      expect(promptUsed).toContain("Retry:");
    });
  });
});
