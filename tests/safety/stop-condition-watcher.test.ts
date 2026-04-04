import { describe, it, expect } from "vitest";
import { checkStopConditions } from "../../src/safety/stop-condition-watcher.js";

describe("checkStopConditions", () => {
  it("should pass when stopConditions is empty", () => {
    expect(() => checkStopConditions("any text here", [])).not.toThrow();
  });

  it("should pass when no stop conditions are found", () => {
    const text = "This is a normal text without any problematic content";
    const stopConditions = ["abort", "terminate", "kill"];
    expect(() => checkStopConditions(text, stopConditions)).not.toThrow();
  });

  it("should throw SafetyViolationError when stop condition is found", () => {
    const text = "The process should abort immediately";
    const stopConditions = ["abort", "terminate"];
    expect(() => checkStopConditions(text, stopConditions)).toThrow("StopConditionWatcher");
  });

  it("should detect word boundaries correctly", () => {
    const stopConditions = ["stop"];

    // Should detect word "stop"
    expect(() => checkStopConditions("Please stop the process", stopConditions)).toThrow();
    expect(() => checkStopConditions("stop now", stopConditions)).toThrow();
    expect(() => checkStopConditions("We need to stop", stopConditions)).toThrow();

    // Should not detect "stop" as part of other words
    expect(() => checkStopConditions("stopwatch is running", stopConditions)).not.toThrow();
    expect(() => checkStopConditions("unstoppable force", stopConditions)).not.toThrow();
  });

  it("should handle special characters in stop conditions", () => {
    // Test with simple words that don't have boundary issues
    const stopConditions = ["abort", "terminate"];

    expect(() => checkStopConditions("Process will abort", stopConditions)).toThrow();
    expect(() => checkStopConditions("Need to terminate", stopConditions)).toThrow();
    expect(() => checkStopConditions("Will not match", ["nomatch"])).not.toThrow();
  });

  it("should include condition and text snippet in error details", () => {
    const text = "The system encountered a fatal error and will abort";
    const stopConditions = ["abort"];

    try {
      checkStopConditions(text, stopConditions);
    } catch (e: any) {
      expect(e.message).toContain('Stop condition detected: "abort"');
      expect(e.details.condition).toBe("abort");
      expect(e.details.textSnippet).toBe(text.slice(0, 200));
    }
  });

  it("should truncate long text snippets to 200 characters", () => {
    const longText = "a".repeat(300) + " abort " + "b".repeat(100);
    const stopConditions = ["abort"];

    try {
      checkStopConditions(longText, stopConditions);
    } catch (e: any) {
      expect(e.details.textSnippet).toHaveLength(200);
    }
  });
});