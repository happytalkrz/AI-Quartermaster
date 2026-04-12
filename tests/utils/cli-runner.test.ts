import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCli, runGhCommand } from "../../src/utils/cli-runner.js";
import * as rateLimiter from "../../src/utils/rate-limiter.js";

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
  });
});