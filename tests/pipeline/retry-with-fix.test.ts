import { describe, it, expect, vi, beforeEach } from "vitest";
import { retryWithClaudeFix, truncateFixPrompt, type RetryWithFixOptions } from "../../src/pipeline/retry-with-fix.js";

// Mock dependencies
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn()
}));

vi.mock("../../src/claude/model-router.js", () => ({
  configForTask: vi.fn(),
  configForTaskWithMode: vi.fn()
}));

vi.mock("../../src/git/commit-helper.js", () => ({
  autoCommitIfDirty: vi.fn()
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}));

// Import mocked functions
import { runClaude } from "../../src/claude/claude-runner.js";
import { configForTask, configForTaskWithMode } from "../../src/claude/model-router.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";

const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTask = vi.mocked(configForTask);
const mockConfigForTaskWithMode = vi.mocked(configForTaskWithMode);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);

describe("retryWithClaudeFix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigForTask.mockReturnValue({ model: "fallback-model" });
    mockConfigForTaskWithMode.mockReturnValue({ model: "fallback-model" });
  });

  it("should return success immediately if initial check passes", async () => {
    const mockResult = { data: "test-data" };

    const options: RetryWithFixOptions<typeof mockResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: true, result: mockResult }),
      buildFixPromptFn: vi.fn(),
      revalidateFn: vi.fn(),
      maxRetries: 3,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})"
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(true);
    expect(result.result).toEqual(mockResult);
    expect(result.attempts).toBe(0);
    expect(options.buildFixPromptFn).not.toHaveBeenCalled();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("should retry and succeed on first attempt", async () => {
    const failedResult = { errors: ["error1", "error2"] };
    const successResult = { errors: [] };
    const fixPrompt = "Fix these errors: error1, error2";

    const onAttempt = vi.fn();
    const onSuccess = vi.fn();

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue(fixPrompt),
      revalidateFn: vi.fn().mockResolvedValue({ success: true, result: successResult }),
      maxRetries: 3,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})",
      onAttempt,
      onSuccess
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(true);
    expect(result.result).toEqual(successResult);
    expect(result.attempts).toBe(1);

    expect(options.buildFixPromptFn).toHaveBeenCalledWith(failedResult);
    expect(mockConfigForTaskWithMode).toHaveBeenCalledWith({ model: "test-model" }, "fallback", "standard");
    expect(mockRunClaude).toHaveBeenCalledWith({
      prompt: fixPrompt,
      cwd: "/test/dir",
      config: { model: "fallback-model" }
    });
    expect(mockAutoCommitIfDirty).toHaveBeenCalledWith("/usr/bin/git", "/test/dir", "fix: test commit (retry 1)");
    expect(options.revalidateFn).toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledWith(1, 3, "Fix these errors: error1, error2");
    expect(onSuccess).toHaveBeenCalledWith(1, successResult);
  });

  it("should fail after max retries", async () => {
    const failedResult = { errors: ["persistent-error"] };
    const fixPrompt = "Fix this error";

    const onAttempt = vi.fn();
    const onFailure = vi.fn();

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue(fixPrompt),
      revalidateFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      maxRetries: 2,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})",
      onAttempt,
      onFailure
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(false);
    expect(result.result).toEqual(failedResult);
    expect(result.attempts).toBe(2);
    expect(result.error).toBe("Failed after 2 attempts");

    expect(mockRunClaude).toHaveBeenCalledTimes(2);
    expect(mockAutoCommitIfDirty).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith(2, failedResult);
  });

  it("should handle Claude execution errors", async () => {
    const failedResult = { errors: ["error"] };
    const claudeError = new Error("Claude execution failed");

    const onFailure = vi.fn();
    mockRunClaude.mockRejectedValueOnce(claudeError);

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue("Fix error"),
      revalidateFn: vi.fn(),
      maxRetries: 1,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})",
      onFailure
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(false);
    expect(result.result).toEqual(failedResult);
    expect(result.attempts).toBe(1);
    expect(result.error).toBe("Final attempt failed: Claude execution failed");

    expect(mockRunClaude).toHaveBeenCalledTimes(1);
    expect(mockAutoCommitIfDirty).not.toHaveBeenCalled(); // Should not commit if Claude fails
    expect(options.revalidateFn).not.toHaveBeenCalled(); // Should not revalidate if Claude fails
    expect(onFailure).toHaveBeenCalledWith(1, failedResult);
  });

  it("should succeed on second attempt after first failure", async () => {
    const failedResult = { errors: ["error"] };
    const successResult = { errors: [] };

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue("Fix error"),
      revalidateFn: vi.fn()
        .mockResolvedValueOnce({ success: false, result: failedResult })  // First attempt fails
        .mockResolvedValueOnce({ success: true, result: successResult }), // Second attempt succeeds
      maxRetries: 3,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})"
    };

    const result = await retryWithClaudeFix(options);

    expect(result.success).toBe(true);
    expect(result.result).toEqual(successResult);
    expect(result.attempts).toBe(2);

    expect(mockRunClaude).toHaveBeenCalledTimes(2);
    expect(mockAutoCommitIfDirty).toHaveBeenCalledTimes(2);
    expect(options.revalidateFn).toHaveBeenCalledTimes(2);
  });

  it("should extract description from prompt correctly", async () => {
    const failedResult = { errors: ["error"] };
    const longPrompt = "This is a very long prompt that should be truncated because it exceeds the character limit";
    const shortPrompt = "Short prompt";

    const onAttempt = vi.fn();

    // Test long prompt truncation
    const options1: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue(longPrompt),
      revalidateFn: vi.fn().mockResolvedValue({ success: true, result: { errors: [] } }),
      maxRetries: 1,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})",
      onAttempt
    };

    await retryWithClaudeFix(options1);
    expect(onAttempt).toHaveBeenCalledWith(1, 1, "This is a very long prompt that should be trunc...");

    // Test short prompt
    vi.clearAllMocks();
    const options2: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue(shortPrompt),
      revalidateFn: vi.fn().mockResolvedValue({ success: true, result: { errors: [] } }),
      maxRetries: 1,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})",
      onAttempt
    };

    await retryWithClaudeFix(options2);
    expect(onAttempt).toHaveBeenCalledWith(1, 1, "Short prompt");
  });

  it("should truncate fix prompt when it exceeds token budget", async () => {
    const failedResult = { errors: ["error"] };

    // Create a very long prompt that exceeds 8000 tokens (32000+ chars)
    const longContent = "This is a very long prompt content. ".repeat(1000);
    const longPrompt = `Fix the following errors:\n\n${longContent}\n\nPlease fix these issues.`;

    const onAttempt = vi.fn();

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue(longPrompt),
      revalidateFn: vi.fn().mockResolvedValue({ success: true, result: { errors: [] } }),
      maxRetries: 1,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})",
      onAttempt
    };

    await retryWithClaudeFix(options);

    // Check that runClaude was called with truncated prompt
    expect(mockRunClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("[... 중간 내용 생략 (토큰 예산 초과로 인한 자동 truncate) ...]"),
      })
    );

    // Verify the prompt was actually truncated (should be much shorter than original)
    const calledPrompt = mockRunClaude.mock.calls[0][0].prompt;
    expect(calledPrompt.length).toBeLessThan(longPrompt.length / 2);
  });

  it("should not truncate fix prompt when within token budget", async () => {
    const failedResult = { errors: ["error"] };
    const shortPrompt = "Fix this small error.";

    const options: RetryWithFixOptions<typeof failedResult> = {
      checkFn: vi.fn().mockResolvedValue({ success: false, result: failedResult }),
      buildFixPromptFn: vi.fn().mockReturnValue(shortPrompt),
      revalidateFn: vi.fn().mockResolvedValue({ success: true, result: { errors: [] } }),
      maxRetries: 1,
      claudeConfig: { model: "test-model" },
      cwd: "/test/dir",
      gitPath: "/usr/bin/git",
      commitMessageTemplate: "fix: test commit (retry {attempt})"
    };

    await retryWithClaudeFix(options);

    // Check that runClaude was called with original prompt (no truncation)
    expect(mockRunClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: shortPrompt,
      })
    );
  });
});

describe("truncateFixPrompt", () => {
  it("should not truncate prompt when within token budget", () => {
    const shortPrompt = "Fix this small error.";

    const result = truncateFixPrompt(shortPrompt);

    expect(result).toBe(shortPrompt);
  });

  it("should truncate prompt when exceeding token budget", () => {
    // Create a very long prompt that exceeds 8000 tokens (40000+ chars)
    const longContent = "This is a very long prompt content that will exceed the token budget. ".repeat(600);
    const longPrompt = `Fix the following errors:\n\n${longContent}\n\nPlease fix these issues.`;

    const result = truncateFixPrompt(longPrompt);

    // Should be truncated and contain truncation marker
    expect(result).toContain("[... 중간 내용 생략 (토큰 예산 초과로 인한 자동 truncate) ...]");
    expect(result.length).toBeLessThan(longPrompt.length);

    // Should start with first part of original prompt
    expect(result).toMatch(/^Fix the following errors:/);

    // Should end with last part of original prompt
    expect(result).toMatch(/Please fix these issues\.$/);
  });

  it("should preserve first and last parts when truncating", () => {
    // Create a structured prompt with clear first and last sections
    const firstPart = "FIRST SECTION: Important context that should be preserved.";
    const middlePart = "MIDDLE SECTION: This is very long content that will be truncated. ".repeat(600); // This will be truncated
    const lastPart = "LAST SECTION: Critical instructions for fixing.";
    const longPrompt = `${firstPart}\n\n${middlePart}\n\n${lastPart}`;

    const result = truncateFixPrompt(longPrompt);

    // Should contain truncation marker
    expect(result).toContain("[... 중간 내용 생략 (토큰 예산 초과로 인한 자동 truncate) ...]");

    // Should preserve important first and last sections
    expect(result).toContain("FIRST SECTION: Important context");
    expect(result).toContain("LAST SECTION: Critical instructions");

    // Middle section should be mostly truncated
    const middleRepeats = (result.match(/MIDDLE SECTION:/g) || []).length;
    expect(middleRepeats).toBeLessThan(100); // Should be much less than the original 600
  });

  it("should result in prompt within token budget after truncation", () => {
    // Create a very long prompt
    const veryLongPrompt = "X".repeat(100000); // Much longer than budget

    const result = truncateFixPrompt(veryLongPrompt);

    // Estimate token count of result (should be within budget)
    const resultTokens = Math.ceil(result.length / 4); // 4 chars per token
    expect(resultTokens).toBeLessThanOrEqual(8000); // Should be within FIX_PROMPT_TOKEN_BUDGET
  });

  it("should handle edge case with empty prompt", () => {
    const emptyPrompt = "";

    const result = truncateFixPrompt(emptyPrompt);

    expect(result).toBe("");
  });

  it("should handle edge case with prompt exactly at budget limit", () => {
    // Create a prompt exactly at 8000 tokens (32000 chars)
    const exactBudgetPrompt = "X".repeat(32000);

    const result = truncateFixPrompt(exactBudgetPrompt);

    expect(result).toBe(exactBudgetPrompt); // Should not be truncated
  });

  it("should maintain valid context structure after truncation", () => {
    // Create a prompt with structured content
    const structuredPrompt = `
## Error Report
The following errors were found:

${"- Error detail line\n".repeat(500)}

## Instructions
Please fix all the above errors by:
1. Reviewing each error
2. Making necessary changes
3. Testing the fixes
    `.trim();

    const result = truncateFixPrompt(structuredPrompt);

    if (result.includes("[... 중간 내용 생략")) {
      // If truncated, should still contain essential structure
      expect(result).toContain("## Error Report");
      expect(result).toContain("## Instructions");
      expect(result).toContain("Please fix all the above errors");
    } else {
      // If not truncated, should be identical
      expect(result).toBe(structuredPrompt);
    }
  });
});