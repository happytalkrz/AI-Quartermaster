import { describe, it, expect } from "vitest";
import {
  isAQMError,
  getErrorMessage,
  getErrorStack,
  getErrorCode,
  getErrorInfo
} from "../../src/utils/error-utils.js";
import {
  AQMError,
  PipelineError,
  ConfigError,
  SafetyViolationError
} from "../../src/types/errors.js";

// Test helper classes
class TestAQMError extends AQMError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

describe("isAQMError", () => {
  it("should return true for AQMError instances", () => {
    const error = new TestAQMError("TEST_ERROR", "test message");
    expect(isAQMError(error)).toBe(true);
  });

  it("should return true for AQMError subclasses", () => {
    const pipelineError = new PipelineError("PIPELINE_ERROR", "pipeline failed");
    const configError = new ConfigError("CONFIG_ERROR", "config invalid");
    const safetyError = new SafetyViolationError("test-guard", "safety violated");

    expect(isAQMError(pipelineError)).toBe(true);
    expect(isAQMError(configError)).toBe(true);
    expect(isAQMError(safetyError)).toBe(true);
  });

  it("should return false for regular Error instances", () => {
    const error = new Error("regular error");
    expect(isAQMError(error)).toBe(false);
  });

  it("should return false for non-error values", () => {
    expect(isAQMError("string error")).toBe(false);
    expect(isAQMError(null)).toBe(false);
    expect(isAQMError(undefined)).toBe(false);
    expect(isAQMError(42)).toBe(false);
    expect(isAQMError({})).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("should extract message from Error instances", () => {
    const error = new Error("test error message");
    expect(getErrorMessage(error)).toBe("test error message");
  });

  it("should extract message from AQMError instances", () => {
    const error = new TestAQMError("TEST_ERROR", "aqm error message");
    expect(getErrorMessage(error)).toBe("aqm error message");
  });

  it("should convert string values to string", () => {
    expect(getErrorMessage("string error")).toBe("string error");
  });

  it("should convert non-error values to string", () => {
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage({ message: "object error" })).toBe("[object Object]");
  });
});

describe("getErrorStack", () => {
  it("should return stack trace for Error instances", () => {
    const error = new Error("test error");
    const stack = getErrorStack(error);
    expect(stack).toBeDefined();
    expect(stack).toContain("Error: test error");
  });

  it("should return stack trace for AQMError instances", () => {
    const error = new TestAQMError("TEST_ERROR", "test message");
    const stack = getErrorStack(error);
    expect(stack).toBeDefined();
  });

  it("should return undefined for non-error values", () => {
    expect(getErrorStack("string error")).toBeUndefined();
    expect(getErrorStack(null)).toBeUndefined();
    expect(getErrorStack({})).toBeUndefined();
  });
});

describe("getErrorCode", () => {
  it("should return code for AQMError instances", () => {
    const error = new TestAQMError("TEST_ERROR", "test message");
    expect(getErrorCode(error)).toBe("TEST_ERROR");
  });

  it("should return code for AQMError subclasses", () => {
    const pipelineError = new PipelineError("PIPELINE_FAILED", "pipeline error");
    const configError = new ConfigError("INVALID_CONFIG", "config error");

    expect(getErrorCode(pipelineError)).toBe("PIPELINE_FAILED");
    expect(getErrorCode(configError)).toBe("INVALID_CONFIG");
  });

  it("should return undefined for regular Error instances", () => {
    const error = new Error("regular error");
    expect(getErrorCode(error)).toBeUndefined();
  });

  it("should return undefined for non-error values", () => {
    expect(getErrorCode("string error")).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
    expect(getErrorCode({})).toBeUndefined();
  });
});

describe("getErrorInfo", () => {
  it("should return complete info for AQMError instances", () => {
    const error = new TestAQMError("TEST_ERROR", "test message");
    const info = getErrorInfo(error);

    expect(info.message).toBe("test message");
    expect(info.code).toBe("TEST_ERROR");
    expect(info.stack).toBeDefined();
    expect(info.isAQMError).toBe(true);
    expect(info.type).toBe("TestAQMError");
  });

  it("should return partial info for regular Error instances", () => {
    const error = new Error("regular error");
    const info = getErrorInfo(error);

    expect(info.message).toBe("regular error");
    expect(info.code).toBeUndefined();
    expect(info.stack).toBeDefined();
    expect(info.isAQMError).toBe(false);
    expect(info.type).toBe("Error");
  });

  it("should return basic info for non-error values", () => {
    const info = getErrorInfo("string error");

    expect(info.message).toBe("string error");
    expect(info.code).toBeUndefined();
    expect(info.stack).toBeUndefined();
    expect(info.isAQMError).toBe(false);
    expect(info.type).toBe("string");
  });

  it("should handle SafetyViolationError with specific properties", () => {
    const error = new SafetyViolationError("test-guard", "safety violation", { detail: "test" });
    const info = getErrorInfo(error);

    expect(info.message).toBe("[test-guard] safety violation");
    expect(info.code).toBe("SAFETY_VIOLATION");
    expect(info.isAQMError).toBe(true);
    expect(info.type).toBe("SafetyViolationError");
  });
});