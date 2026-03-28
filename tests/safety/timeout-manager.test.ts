import { describe, it, expect } from "vitest";
import { withTimeout, PipelineTimer } from "../../src/safety/timeout-manager.js";

describe("withTimeout", () => {
  it("should resolve when operation completes within timeout", async () => {
    const result = await withTimeout(
      async () => "done",
      1000,
      "test"
    );
    expect(result).toBe("done");
  });

  it("should throw TimeoutError when operation exceeds timeout", async () => {
    await expect(
      withTimeout(
        () => new Promise(resolve => setTimeout(resolve, 500)),
        50,
        "slow-op"
      )
    ).rejects.toThrow("Timeout");
  });

  it("should propagate non-timeout errors", async () => {
    await expect(
      withTimeout(
        async () => { throw new Error("custom error"); },
        1000,
        "test"
      )
    ).rejects.toThrow("custom error");
  });
});

describe("PipelineTimer", () => {
  it("should track elapsed time", async () => {
    const timer = new PipelineTimer(10000);
    expect(timer.elapsed).toBeGreaterThanOrEqual(0);
    expect(timer.remaining).toBeLessThanOrEqual(10000);
    expect(timer.isExpired).toBe(false);
  });

  it("should detect expiration", () => {
    const timer = new PipelineTimer(0); // already expired
    expect(timer.isExpired).toBe(true);
    expect(() => timer.assertNotExpired("test")).toThrow("Timeout");
  });
});
