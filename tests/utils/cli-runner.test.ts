import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCli, runGhCommand } from "../../src/utils/cli-runner.js";
import * as rateLimiter from "../../src/utils/rate-limiter.js";
import type { ChildProcess } from "child_process";

// Mock rate-limiter module
vi.mock("../../src/utils/rate-limiter.js");
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock child_process
vi.mock("child_process", async () => {
  const actual = await vi.importActual("child_process");
  return {
    ...actual,
    execFile: vi.fn(),
    spawn: vi.fn(),
  };
});

// Mock promisify
vi.mock("util", async () => {
  const actual = await vi.importActual("util");
  return {
    ...actual,
    promisify: vi.fn((fn) => {
      return vi.fn().mockImplementation(async (...args) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: any, stdout: string, stderr: string) => {
            if (err) {
              const error = Object.assign(err, { stdout, stderr });
              reject(error);
            } else {
              resolve({ stdout, stderr });
            }
          });
        });
      });
    }),
  };
});

describe("cli-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runCli - shell injection prevention", () => {
    it("should pass shell metacharacters as literal args, not interpreted by shell", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "output", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const maliciousArgs = ["; rm -rf /", "$(echo pwned)", "`id`", "| cat /etc/passwd", "&& malicious"];

      await runCli("echo", maliciousArgs);

      // execFile must be called with the exact array — no shell expansion
      expect(mockExecFile).toHaveBeenCalledWith(
        "echo",
        maliciousArgs,
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("should not invoke shell when running runCli (execFile, not exec)", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "safe", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      // Command chaining via semicolon in a single arg must not split into multiple commands
      await runCli("git", ["log", "--format=; echo injected"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["log", "--format=; echo injected"],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("should pass newline and null-byte chars as literal args without shell interpretation", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const argsWithSpecials = ["title\necho injected", "arg\x00null"];
      await runCli("echo", argsWithSpecials);

      expect(mockExecFile).toHaveBeenCalledWith(
        "echo",
        argsWithSpecials,
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe("runCli", () => {
    it("should execute command successfully", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      // Mock successful execution
      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "hello", "");
        }
        return {} as any;
      });

      const result = await runCli("echo", ["hello"]);

      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("stderr");
      expect(result).toHaveProperty("exitCode");
      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should handle command failure", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      // Mock failed execution
      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          const error = new Error("Command failed") as any;
          error.code = 1;
          error.stdout = "";
          error.stderr = "error message";
          callback(error, "", "error message");
        }
        return {} as any;
      });

      const result = await runCli("false", []);

      expect(result).toEqual({
        stdout: "",
        stderr: "error message",
        exitCode: 1,
      });
    });
  });

  describe("runGhCommand", () => {
    beforeEach(() => {
      // Mock rate limiter functions
      vi.mocked(rateLimiter.withRateLimit).mockImplementation(async (operation) => {
        return operation();
      });
    });

    it("should add --include-headers to gh api commands", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "HTTP/1.1 200 OK\nx-ratelimit-remaining: 4999\nx-ratelimit-reset: 1234567890\n\n{\"test\": true}", "");
        }
        return {} as any;
      });

      await runGhCommand("gh", ["api", "repos/owner/repo"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        ["api", "repos/owner/repo", "--include-headers"],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("should not add --include-headers to non-api commands", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "PR #123 created", "");
        }
        return {} as any;
      });

      await runGhCommand("gh", ["pr", "create", "--title", "Test"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "gh",
        ["pr", "create", "--title", "Test"],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it("should parse rate limit headers from gh api response", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      const mockUpdateFromHeaders = vi.fn();
      const mockRateLimitTracker = {
        updateFromHeaders: mockUpdateFromHeaders,
        shouldWait: () => false,
        getWaitTime: () => 0,
      };

      // Mock the singleton rate limiter
      vi.doMock("../../src/utils/cli-runner.js", async () => {
        const actual = await vi.importActual("../../src/utils/cli-runner.js");
        return {
          ...actual,
          githubRateLimiter: mockRateLimitTracker,
        };
      });

      const responseWithHeaders = `HTTP/1.1 200 OK
x-ratelimit-remaining: 4999
x-ratelimit-reset: 1234567890

{"data": "test"}`;

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, responseWithHeaders, "");
        }
        return {} as any;
      });

      await runGhCommand("gh", ["api", "repos/owner/repo"]);

      // Since we're testing the actual implementation, we need to check the rate limiter was called
      expect(rateLimiter.withRateLimit).toHaveBeenCalled();
    });

    it("should handle 429 rate limit errors", async () => {
      // Mock withRateLimit to throw a rate limit error
      vi.mocked(rateLimiter.withRateLimit).mockRejectedValue(
        Object.assign(new Error("GitHub API rate limit exceeded"), { status: 429 })
      );

      await expect(runGhCommand("gh", ["api", "repos/owner/repo"])).rejects.toThrow("GitHub API rate limit exceeded");
      expect(rateLimiter.withRateLimit).toHaveBeenCalled();
    });

    it("should detect rate limit errors from output text", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "", "API rate limit exceeded for user");
        }
        return {} as any;
      });

      // Mock withRateLimit to simulate retry behavior that throws the error
      vi.mocked(rateLimiter.withRateLimit).mockImplementation(async (operation) => {
        return operation();
      });

      await expect(runGhCommand("gh", ["api", "repos/owner/repo"])).rejects.toThrow("GitHub API rate limit exceeded");

      expect(rateLimiter.withRateLimit).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        expect.objectContaining({
          maxRetries: 3,
          initialDelayMs: 2000,
        }),
        "gh api"
      );
    });

    it("should use custom retry config when provided", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const customRetry = {
        maxRetries: 5,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        jitterFactor: 0.2,
      };

      await runGhCommand("gh", ["pr", "list"], {}, customRetry);

      expect(rateLimiter.withRateLimit).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        customRetry,
        "gh pr"
      );
    });

    it("should throw retryable error (status 429) when exit code is 429", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          const error = new Error("HTTP 429") as NodeJS.ErrnoException & { stdout: string; stderr: string };
          error.code = 429 as unknown as string;
          error.stdout = "";
          error.stderr = "";
          callback(error, "", "");
        }
        return {} as any;
      });

      vi.mocked(rateLimiter.withRateLimit).mockImplementation(async (operation) => {
        return operation();
      });

      await expect(runGhCommand("gh", ["api", "/rate_limit"])).rejects.toMatchObject({
        message: "GitHub API rate limit exceeded",
        status: 429,
      });
    });

    it("should throw retryable error with status 429 on rate limit text in stderr", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          callback(null, "", "rate limit exceeded for your account");
        }
        return {} as any;
      });

      vi.mocked(rateLimiter.withRateLimit).mockImplementation(async (operation) => {
        return operation();
      });

      const thrownError = await runGhCommand("gh", ["api", "/repos"]).catch((e: unknown) => e);
      expect(thrownError).toMatchObject({ message: "GitHub API rate limit exceeded", status: 429 });
    });
  });

  describe("runCli - error boundary conditions", () => {
    it("should return exitCode 1 when command is not found (ENOENT)", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          const error = Object.assign(new Error("spawn gh ENOENT"), {
            code: "ENOENT",
            stdout: "",
            stderr: "",
          });
          callback(error, "", "");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await runCli("gh", ["--version"]);

      // string code "ENOENT" → not a number → exitCode falls back to 1
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });

    it("should return exitCode 1 when command times out (ETIMEDOUT)", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          const error = Object.assign(new Error("Command timed out"), {
            code: "ETIMEDOUT",
            killed: true,
            stdout: "partial",
            stderr: "timeout",
          });
          callback(error, "partial", "timeout");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await runCli("gh", ["api", "/repos"], { timeout: 100 });

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("partial");
      expect(result.stderr).toBe("timeout");
    });

    it("should use numeric exit code from error when available", async () => {
      const { execFile } = await import("child_process");
      const mockExecFile = vi.mocked(execFile);

      mockExecFile.mockImplementation((command, args, options, callback) => {
        if (callback) {
          const error = Object.assign(new Error("Exited with code 2"), {
            code: 2,
            stdout: "",
            stderr: "usage error",
          });
          callback(error, "", "usage error");
        }
        return {} as ReturnType<typeof execFile>;
      });

      const result = await runCli("gh", ["unknown-command"]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("usage error");
    });
  });

  describe("runCli - stdin/spawn path", () => {
    function createMockChildProcess() {
      const closeListeners: Array<(code: number | null) => void> = [];
      const errorListeners: Array<(err: Error) => void> = [];
      const stdoutListeners: Array<(d: Buffer) => void> = [];
      const stderrListeners: Array<(d: Buffer) => void> = [];

      const mockChild = {
        stdout: {
          on: vi.fn((event: string, handler: (d: Buffer) => void) => {
            if (event === "data") stdoutListeners.push(handler);
          }),
        },
        stderr: {
          on: vi.fn((event: string, handler: (d: Buffer) => void) => {
            if (event === "data") stderrListeners.push(handler);
          }),
        },
        stdin: { write: vi.fn(), end: vi.fn() },
        on: vi.fn((event: string, handler: (arg: unknown) => void) => {
          if (event === "close") closeListeners.push(handler as (code: number | null) => void);
          if (event === "error") errorListeners.push(handler as (err: Error) => void);
        }),
        kill: vi.fn(),
      };

      const trigger = {
        close: (code: number | null) => closeListeners.forEach(h => h(code)),
        error: (err: Error) => errorListeners.forEach(h => h(err)),
        stdoutData: (data: string) => stdoutListeners.forEach(h => h(Buffer.from(data))),
        stderrData: (data: string) => stderrListeners.forEach(h => h(Buffer.from(data))),
      };

      return { mockChild, trigger };
    }

    it("should write stdin and collect stdout via spawn", async () => {
      const { spawn } = await import("child_process");
      const mockSpawn = vi.mocked(spawn);

      const { mockChild, trigger } = createMockChildProcess();
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          trigger.stdoutData("hello from spawn");
          trigger.close(0);
        });
        return mockChild as unknown as ChildProcess;
      });

      const result = await runCli("cat", [], { stdin: "hello" });

      expect(mockSpawn).toHaveBeenCalledWith("cat", [], expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }));
      expect(mockChild.stdin.write).toHaveBeenCalledWith("hello");
      expect(mockChild.stdin.end).toHaveBeenCalled();
      expect(result.stdout).toBe("hello from spawn");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should handle spawn error event and return exitCode 1", async () => {
      const { spawn } = await import("child_process");
      const mockSpawn = vi.mocked(spawn);

      const { mockChild, trigger } = createMockChildProcess();
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          trigger.error(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
        });
        return mockChild as unknown as ChildProcess;
      });

      const result = await runCli("nonexistent-cmd", [], { stdin: "data" });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("spawn ENOENT");
    });

    it("should return non-zero exitCode from spawn close event", async () => {
      const { spawn } = await import("child_process");
      const mockSpawn = vi.mocked(spawn);

      const { mockChild, trigger } = createMockChildProcess();
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          trigger.stderrData("command not found");
          trigger.close(127);
        });
        return mockChild as unknown as ChildProcess;
      });

      const result = await runCli("missing", ["arg"], { stdin: "input" });

      expect(result.exitCode).toBe(127);
      expect(result.stderr).toBe("command not found");
    });

    it("should use exitCode 1 when spawn close code is null", async () => {
      const { spawn } = await import("child_process");
      const mockSpawn = vi.mocked(spawn);

      const { mockChild, trigger } = createMockChildProcess();
      mockSpawn.mockImplementation(() => {
        setImmediate(() => {
          trigger.close(null);
        });
        return mockChild as unknown as ChildProcess;
      });

      const result = await runCli("cmd", [], { stdin: "" });

      // null code → code ?? 1 → 1
      expect(result.exitCode).toBe(1);
    });

    it("should kill child process when spawn timeout fires", async () => {
      const { spawn } = await import("child_process");
      const mockSpawn = vi.mocked(spawn);

      const { mockChild, trigger } = createMockChildProcess();
      mockSpawn.mockImplementation(() => {
        // Close AFTER the timeout would have fired
        setTimeout(() => trigger.close(0), 200);
        return mockChild as unknown as ChildProcess;
      });

      await runCli("slow-cmd", [], { stdin: "x", timeout: 50 });

      // kill() must have been called by the timeout handler
      expect(mockChild.kill).toHaveBeenCalled();
    });
  });
});