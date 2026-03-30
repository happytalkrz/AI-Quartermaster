import { describe, it, expect } from "vitest";
import { extractJson, type ClaudeRunOptions } from "../../src/claude/claude-runner.js";

describe("extractJson", () => {
  it("should parse plain JSON string", () => {
    const result = extractJson('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("should extract JSON from markdown code block", () => {
    const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
    const result = extractJson(text);
    expect(result).toEqual({ key: "value" });
  });

  it("should extract JSON object from mixed text", () => {
    const text = 'Here is the result: {"count": 42, "items": ["a", "b"]} end';
    const result = extractJson(text);
    expect(result).toEqual({ count: 42, items: ["a", "b"] });
  });

  it("should throw on invalid JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });

  it("should handle nested JSON objects", () => {
    const json = '{"outer": {"inner": {"deep": true}}}';
    const result = extractJson(json);
    expect(result).toEqual({ outer: { inner: { deep: true } } });
  });
});

describe("ClaudeRunOptions", () => {
  it("should accept maxTurns and enableAgents options", () => {
    // Type-only test: verify the interface accepts the new options
    const options: ClaudeRunOptions = {
      prompt: "test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: []
      },
      maxTurns: 15,
      enableAgents: true
    };

    expect(options.maxTurns).toBe(15);
    expect(options.enableAgents).toBe(true);
  });

  it("should work without maxTurns and enableAgents options", () => {
    // Verify backward compatibility
    const options: ClaudeRunOptions = {
      prompt: "test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: []
      }
    };

    expect(options.maxTurns).toBeUndefined();
    expect(options.enableAgents).toBeUndefined();
  });
});
