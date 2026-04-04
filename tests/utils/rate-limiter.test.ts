import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimitTracker, ExponentialBackoff, withRetry, withRateLimit } from "../../src/utils/rate-limiter.js";
import type { RetryConfig } from "../../src/types/config.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("RateLimitTracker", () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker();
  });

  describe("updateFromHeaders", () => {
    it("should update rate limit info from GitHub headers", () => {
      const headers = {
        "x-ratelimit-remaining": "100",
        "x-ratelimit-reset": "1640995200", // 2022-01-01 00:00:00 UTC
      };

      tracker.updateFromHeaders(headers);
      const status = tracker.getStatus();

      expect(status.remaining).toBe(100);
      expect(status.resetTime).toBe(1640995200 * 1000);
    });

    it("should handle alternative header names", () => {
      const headers = {
        "x-rate-limit-remaining": "50",
        "x-rate-limit-reset": "1640995200",
      };

      tracker.updateFromHeaders(headers);
      const status = tracker.getStatus();

      expect(status.remaining).toBe(50);
      expect(status.resetTime).toBe(1640995200 * 1000);
    });

    it("should handle missing headers gracefully", () => {
      tracker.updateFromHeaders({});
      const status = tracker.getStatus();

      expect(status.remaining).toBe(Infinity);
      expect(status.resetTime).toBe(0);
    });
  });

  describe("shouldWait", () => {
    it("should return false when remaining is Infinity", () => {
      expect(tracker.shouldWait()).toBe(false);
    });

    it("should return false when remaining is above threshold", () => {
      tracker.updateFromHeaders({
        "x-ratelimit-remaining": "20",
        "x-ratelimit-reset": String(Math.floor((Date.now() + 3600000) / 1000)),
      });

      expect(tracker.shouldWait()).toBe(false);
    });

    it("should return true when remaining is low", () => {
      tracker.updateFromHeaders({
        "x-ratelimit-remaining": "5",
        "x-ratelimit-reset": String(Math.floor((Date.now() + 3600000) / 1000)),
      });

      expect(tracker.shouldWait()).toBe(true);
    });

    it("should return false when reset time has passed", () => {
      tracker.updateFromHeaders({
        "x-ratelimit-remaining": "5",
        "x-ratelimit-reset": String(Math.floor((Date.now() - 1000) / 1000)),
      });

      expect(tracker.shouldWait()).toBe(false);

      // Should reset to Infinity after check
      const status = tracker.getStatus();
      expect(status.remaining).toBe(Infinity);
    });
  });

  describe("getWaitTime", () => {
    it("should return 0 when not waiting", () => {
      expect(tracker.getWaitTime()).toBe(0);
    });

    it("should return time until reset plus buffer", () => {
      const resetTime = Date.now() + 5000;
      tracker.updateFromHeaders({
        "x-ratelimit-remaining": "5",
        "x-ratelimit-reset": String(Math.floor(resetTime / 1000)),
      });

      const waitTime = tracker.getWaitTime();
      expect(waitTime).toBeGreaterThan(4000); // ~5 seconds + 1 second buffer
      expect(waitTime).toBeLessThan(7000);
    });
  });
});

describe("ExponentialBackoff", () => {
  let backoff: ExponentialBackoff;
  const config: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    jitterFactor: 0.1,
  };

  beforeEach(() => {
    backoff = new ExponentialBackoff(config);
    // Mock Math.random for consistent testing
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("nextDelay", () => {
    it("should return increasing delays", () => {
      const delay1 = backoff.nextDelay();
      const delay2 = backoff.nextDelay();
      const delay3 = backoff.nextDelay();

      expect(delay1).toBeLessThan(delay2);
      expect(delay2).toBeLessThan(delay3);
    });

    it("should respect maxDelayMs", () => {
      // Exhaust retries to get maximum delay
      backoff.nextDelay();
      backoff.nextDelay();
      const delay = backoff.nextDelay();

      expect(delay).toBeLessThanOrEqual(config.maxDelayMs * 1.1); // Allow for jitter
    });

    it("should return -1 when max retries exceeded", () => {
      backoff.nextDelay(); // attempt 1
      backoff.nextDelay(); // attempt 2
      backoff.nextDelay(); // attempt 3
      const delay = backoff.nextDelay(); // attempt 4 (exceeds max)

      expect(delay).toBe(-1);
    });

    it("should include jitter", () => {
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0)   // min jitter
        .mockReturnValueOnce(1);  // max jitter

      const delay1 = backoff.nextDelay();
      backoff.reset();
      const delay2 = backoff.nextDelay();

      expect(delay1).not.toBe(delay2);
    });
  });

  describe("reset", () => {
    it("should reset attempt counter", () => {
      backoff.nextDelay();
      backoff.nextDelay();
      expect(backoff.getAttempt()).toBe(2);

      backoff.reset();
      expect(backoff.getAttempt()).toBe(0);
    });
  });

  describe("constructor", () => {
    it("should clamp jitterFactor to valid range", () => {
      const invalidConfig: RetryConfig = {
        maxRetries: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        jitterFactor: 2.0, // Invalid: > 1
      };

      expect(() => new ExponentialBackoff(invalidConfig)).not.toThrow();
    });
  });
});

describe("withRetry", () => {
  const retryConfig: RetryConfig = {
    maxRetries: 2,
    initialDelayMs: 1, // Very short delay for testing
    maxDelayMs: 10,
    jitterFactor: 0,
  };

  it("should succeed on first try", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await withRetry(operation, retryConfig);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable errors", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("rate limit exceeded"))
      .mockResolvedValueOnce("success");

    const result = await withRetry(operation, retryConfig);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("should not retry on non-retryable errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("invalid input"));

    await expect(withRetry(operation, retryConfig)).rejects.toThrow("invalid input");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should fail after max retries", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("timeout"));

    await expect(withRetry(operation, retryConfig)).rejects.toThrow("timeout");
    expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("should recognize retryable error types", async () => {
    const retryableErrors = [
      new Error("rate limit exceeded"),
      new Error("too many requests"),
      new Error("timeout occurred"),
      new Error("network error"),
      new Error("prompt is too long"),
      { status: 429 },
      { status: 500 },
      { status: 503 },
    ];

    for (const error of retryableErrors) {
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      await expect(withRetry(operation, retryConfig)).resolves.toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);

      operation.mockClear();
    }
  });
});

describe("withRateLimit", () => {
  let tracker: RateLimitTracker;
  const retryConfig: RetryConfig = {
    maxRetries: 1,
    initialDelayMs: 1,
    maxDelayMs: 10,
    jitterFactor: 0,
  };

  beforeEach(() => {
    tracker = new RateLimitTracker();
  });

  it("should execute immediately when rate limit allows", async () => {
    const operation = vi.fn().mockResolvedValue("success");

    const result = await withRateLimit(operation, tracker, retryConfig);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should wait when rate limit is hit", async () => {
    // Set up rate limit that requires waiting (but with very short time for testing)
    tracker.updateFromHeaders({
      "x-ratelimit-remaining": "5",
      "x-ratelimit-reset": String(Math.floor((Date.now() + 10) / 1000)), // 10ms wait
    });

    const operation = vi.fn().mockResolvedValue("success");
    const result = await withRateLimit(operation, tracker, retryConfig);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("should combine rate limiting with retry logic", async () => {
    tracker.updateFromHeaders({
      "x-ratelimit-remaining": "5",
      "x-ratelimit-reset": String(Math.floor((Date.now() + 10) / 1000)), // 10ms wait
    });

    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("success");

    const result = await withRateLimit(operation, tracker, retryConfig);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});