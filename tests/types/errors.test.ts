import { describe, it, expect } from "vitest";
import {
  AQMError,
  PipelineError,
  ConfigError,
  GitError,
  SafetyViolationError,
  TimeoutError,
  RollbackError
} from "../../src/types/errors.js";
import { getErrorMessage } from "../../src/utils/error-utils.js";

// Test helper class to test abstract AQMError
class TestAQMError extends AQMError {
  constructor(code: string, message: string, cause?: Error | unknown) {
    super(code, message, cause);
  }
}

describe("AQMError", () => {
  it("should create error with code and message", () => {
    const error = new TestAQMError("TEST_CODE", "test message");

    expect(error.code).toBe("TEST_CODE");
    expect(error.message).toBe("test message");
    expect(error.name).toBe("TestAQMError");
    expect(error.cause).toBeUndefined();
  });

  it("should create error with cause", () => {
    const cause = new Error("underlying error");
    const error = new TestAQMError("TEST_CODE", "test message", cause);

    expect(error.code).toBe("TEST_CODE");
    expect(error.message).toBe("test message");
    expect(error.cause).toBe(cause);
  });

  it("should maintain proper instanceof chain", () => {
    const error = new TestAQMError("TEST_CODE", "test message");

    expect(error instanceof AQMError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(error instanceof TestAQMError).toBe(true);
  });

  it("should set prototype correctly for proper inheritance", () => {
    const error = new TestAQMError("TEST_CODE", "test message");

    expect(Object.getPrototypeOf(error)).toBe(TestAQMError.prototype);
  });
});

describe("PipelineError", () => {
  it("should create pipeline error with correct properties", () => {
    const error = new PipelineError("PIPELINE_FAILED", "Phase execution failed");

    expect(error.code).toBe("PIPELINE_FAILED");
    expect(error.message).toBe("Phase execution failed");
    expect(error.name).toBe("PipelineError");
    expect(error instanceof PipelineError).toBe(true);
    expect(error instanceof AQMError).toBe(true);
  });

  it("should support cause parameter", () => {
    const cause = new Error("underlying error");
    const error = new PipelineError("PHASE_ERROR", "Phase failed", cause);

    expect(error.cause).toBe(cause);
  });
});

describe("ConfigError", () => {
  it("should create config error with correct properties", () => {
    const error = new ConfigError("INVALID_YAML", "YAML parsing failed");

    expect(error.code).toBe("INVALID_YAML");
    expect(error.message).toBe("YAML parsing failed");
    expect(error.name).toBe("ConfigError");
    expect(error instanceof ConfigError).toBe(true);
    expect(error instanceof AQMError).toBe(true);
  });

  it("should support validation errors", () => {
    const validationError = new Error("Schema validation failed");
    const error = new ConfigError("VALIDATION_FAILED", "Config validation failed", validationError);

    expect(error.cause).toBe(validationError);
  });
});

describe("GitError", () => {
  it("should create git error with correct properties", () => {
    const error = new GitError("WORKTREE_FAILED", "Failed to create worktree");

    expect(error.code).toBe("WORKTREE_FAILED");
    expect(error.message).toBe("Failed to create worktree");
    expect(error.name).toBe("GitError");
    expect(error instanceof GitError).toBe(true);
    expect(error instanceof AQMError).toBe(true);
  });

  it("should handle git command failures", () => {
    const gitError = new Error("fatal: not a git repository");
    const error = new GitError("NOT_GIT_REPO", "Git operation failed", gitError);

    expect(error.cause).toBe(gitError);
  });
});

describe("SafetyViolationError", () => {
  it("should create safety error with guard and message", () => {
    const error = new SafetyViolationError("path-guard", "Attempting to modify protected path");

    expect(error.code).toBe("SAFETY_VIOLATION");
    expect(error.guard).toBe("path-guard");
    expect(error.message).toBe("[path-guard] Attempting to modify protected path");
    expect(error.name).toBe("SafetyViolationError");
    expect(error.details).toBeUndefined();
  });

  it("should include guard name in message", () => {
    const error = new SafetyViolationError("timeout-guard", "Operation timed out");

    expect(error.message).toBe("[timeout-guard] Operation timed out");
  });

  it("should support details object", () => {
    const details = { path: "/protected/path", operation: "delete" };
    const error = new SafetyViolationError("path-guard", "Protected path access", details);

    expect(error.details).toBe(details);
    expect(error.details?.path).toBe("/protected/path");
  });

  it("should inherit from AQMError", () => {
    const error = new SafetyViolationError("test-guard", "test message");

    expect(error instanceof SafetyViolationError).toBe(true);
    expect(error instanceof AQMError).toBe(true);
  });
});

describe("TimeoutError", () => {
  it("should create timeout error with stage and timeout", () => {
    const error = new TimeoutError("phase-execution", 30000);

    expect(error.code).toBe("TIMEOUT");
    expect(error.stage).toBe("phase-execution");
    expect(error.timeoutMs).toBe(30000);
    expect(error.message).toBe("Timeout in phase-execution after 30000ms");
    expect(error.name).toBe("TimeoutError");
  });

  it("should format message with stage and timeout", () => {
    const error = new TimeoutError("claude-execution", 120000);

    expect(error.message).toBe("Timeout in claude-execution after 120000ms");
  });

  it("should inherit from AQMError", () => {
    const error = new TimeoutError("test-stage", 5000);

    expect(error instanceof TimeoutError).toBe(true);
    expect(error instanceof AQMError).toBe(true);
  });
});

describe("RollbackError", () => {
  it("should create rollback error with target hash", () => {
    const error = new RollbackError("abc123def", "Git reset failed");

    expect(error.code).toBe("ROLLBACK_FAILED");
    expect(error.targetHash).toBe("abc123def");
    expect(error.message).toBe("Rollback to abc123def failed: Git reset failed");
    expect(error.name).toBe("RollbackError");
  });

  it("should format message with target hash", () => {
    const error = new RollbackError("xyz789", "Working tree dirty");

    expect(error.message).toBe("Rollback to xyz789 failed: Working tree dirty");
  });

  it("should inherit from AQMError", () => {
    const error = new RollbackError("abc123", "test failure");

    expect(error instanceof RollbackError).toBe(true);
    expect(error instanceof AQMError).toBe(true);
  });
});

describe("getErrorMessage", () => {
  it("should extract message from Error instances", () => {
    const error = new Error("test error");
    expect(getErrorMessage(error)).toBe("test error");
  });

  it("should convert non-Error values to string", () => {
    expect(getErrorMessage("string error")).toBe("string error");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(42)).toBe("42");
  });

  it("should work with AQMError instances", () => {
    const error = new TestAQMError("TEST_CODE", "aqm error message");
    expect(getErrorMessage(error)).toBe("aqm error message");
  });
});