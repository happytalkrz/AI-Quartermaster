import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractJson, type ClaudeRunOptions, runClaude } from "../../src/claude/claude-runner.js";
import { spawn } from "child_process";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process");
const mockSpawn = vi.mocked(spawn);

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

describe("runClaude retry behavior", () => {
  let mockChild: EventEmitter & {
    pid: number;
    stdin: { write: () => void; end: () => void };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
    killed: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      killed: false,
    });

    mockSpawn.mockReturnValue(mockChild as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should retry on rate limit error", async () => {
    const options: ClaudeRunOptions = {
      prompt: "test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: [],
        retry: {
          maxRetries: 2,
          initialDelayMs: 100,
          maxDelayMs: 1000,
          jitterFactor: 0.1,
        },
      },
    };

    const runPromise = runClaude(options);

    // Simulate first attempt - rate limit error
    setTimeout(() => {
      mockChild.stderr.emit("data", Buffer.from("Error: rate limit exceeded"));
      mockChild.emit("close", 1);
    }, 10);

    // Simulate second attempt - success
    setTimeout(() => {
      const secondMockChild = Object.assign(new EventEmitter(), {
        pid: 12346,
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
        killed: false,
      });

      mockSpawn.mockReturnValueOnce(secondMockChild as any);

      setTimeout(() => {
        secondMockChild.stdout.emit("data", Buffer.from('{"type": "result", "result": "success"}\n'));
        secondMockChild.emit("close", 0);
      }, 150);
    }, 120);

    const result = await runPromise;
    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2); // First attempt + retry
  });

  it("should retry on prompt too long error", async () => {
    const options: ClaudeRunOptions = {
      prompt: "test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: [],
        retry: {
          maxRetries: 1,
          initialDelayMs: 100,
          maxDelayMs: 1000,
          jitterFactor: 0.1,
        },
      },
    };

    let callCount = 0;
    mockSpawn.mockImplementation(() => {
      callCount++;
      const child = Object.assign(new EventEmitter(), {
        pid: 12345 + callCount,
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(),
        killed: false,
      });

      // Both attempts fail with prompt too long
      setTimeout(() => {
        child.stderr.emit("data", Buffer.from("Error: prompt is too long"));
        child.emit("close", 1);
      }, 10);

      return child as any;
    });

    const runPromise = runClaude(options);

    try {
      await runPromise;
      expect.fail("Should have thrown after exhausting retries");
    } catch (error) {
      expect((error as Error).message).toContain("prompt is too long");
      expect(mockSpawn).toHaveBeenCalledTimes(2); // Original + 1 retry
    }
  }, 10000);

  it("should not retry on non-retryable errors", async () => {
    const options: ClaudeRunOptions = {
      prompt: "test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: [],
        retry: {
          maxRetries: 2,
          initialDelayMs: 100,
          maxDelayMs: 1000,
          jitterFactor: 0.1,
        },
      },
    };

    const runPromise = runClaude(options);

    // Simulate non-retryable error
    setTimeout(() => {
      mockChild.stderr.emit("data", Buffer.from("Error: invalid syntax"));
      mockChild.emit("close", 1);
    }, 10);

    const result = await runPromise;
    expect(result.success).toBe(false);
    expect(mockSpawn).toHaveBeenCalledTimes(1); // No retry
  });

  it("should work without retry config", async () => {
    const options: ClaudeRunOptions = {
      prompt: "test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: [],
        // No retry config
      },
    };

    const runPromise = runClaude(options);

    setTimeout(() => {
      mockChild.stdout.emit("data", Buffer.from('{"type": "result", "result": "success"}\n'));
      mockChild.emit("close", 0);
    }, 10);

    const result = await runPromise;
    expect(result.success).toBe(true);
  });
});
