import { describe, it, expect, vi, beforeEach } from "vitest";
import { retryWithClaudeFix, type RetryWithFixOptions } from "../../src/pipeline/retry-with-fix.js";

// Mock dependencies
vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn()
}));

vi.mock("../../src/claude/model-router.js", () => ({
  configForTask: vi.fn()
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
import { configForTask } from "../../src/claude/model-router.js";
import { autoCommitIfDirty } from "../../src/git/commit-helper.js";

const mockRunClaude = vi.mocked(runClaude);
const mockConfigForTask = vi.mocked(configForTask);
const mockAutoCommitIfDirty = vi.mocked(autoCommitIfDirty);

describe("retryWithClaudeFix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigForTask.mockReturnValue({ model: "fallback-model" });
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
    expect(mockConfigForTask).toHaveBeenCalledWith({ model: "test-model" }, "fallback");
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
});