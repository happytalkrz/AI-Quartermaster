import { describe, it, expect, vi, beforeEach } from "vitest";
import { Coordinator } from "../../src/claude/coordinator.js";
import type { WorkerPool, CoordinatorTask } from "../../src/claude/coordinator.js";
import type { ClaudeRunResult, ClaudeRunOptions } from "../../src/claude/claude-runner.js";

vi.mock("../../src/claude/claude-runner.js", () => ({
  runClaude: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { runClaude } from "../../src/claude/claude-runner.js";

const mockRunClaude = vi.mocked(runClaude);

const baseOptions: ClaudeRunOptions = {
  prompt: "test prompt",
  config: {
    path: "claude",
    model: "sonnet",
    maxTurns: 10,
    timeout: 30000,
    additionalArgs: [],
  },
};

const successResult: ClaudeRunResult = {
  success: true,
  output: "done",
  durationMs: 100,
};

const failureResult: ClaudeRunResult = {
  success: false,
  output: "error output",
  durationMs: 50,
};

function makeWorkerPool(available: boolean, result?: ClaudeRunResult): WorkerPool {
  return {
    isAvailable: vi.fn().mockReturnValue(available),
    submitTask: vi.fn().mockResolvedValue(result ?? successResult),
  };
}

describe("Coordinator — multiAI disabled (single execution)", () => {
  beforeEach(() => {
    mockRunClaude.mockReset();
  });

  it("submits task and completes via runClaude", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    expect(taskId).toBeTruthy();

    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("completed");
    expect(result.taskId).toBe(taskId);
    expect(result.result).toEqual(successResult);
    expect(mockRunClaude).toHaveBeenCalledWith(baseOptions);
  });

  it("marks task as failed when runClaude returns success=false", async () => {
    mockRunClaude.mockResolvedValue(failureResult);
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("failed");
    expect(result.error).toBe(failureResult.output);
  });

  it("marks task as failed when runClaude throws", async () => {
    mockRunClaude.mockRejectedValue(new Error("spawn failed"));
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("spawn failed");
  });

  it("ignores worker pool even if provided", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const pool = makeWorkerPool(true);
    const coordinator = new Coordinator(false, pool);

    const taskId = await coordinator.submitTask(baseOptions);
    await coordinator.waitForCompletion(taskId);

    expect(mockRunClaude).toHaveBeenCalledOnce();
    expect(pool.submitTask).not.toHaveBeenCalled();
  });
});

describe("Coordinator — multiAI enabled", () => {
  beforeEach(() => {
    mockRunClaude.mockReset();
  });

  it("dispatches to worker pool when available", async () => {
    const pool = makeWorkerPool(true, successResult);
    const coordinator = new Coordinator(true, pool);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("completed");
    expect(pool.submitTask).toHaveBeenCalledOnce();
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it("falls back to runClaude when worker pool is unavailable", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const pool = makeWorkerPool(false);
    const coordinator = new Coordinator(true, pool);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("completed");
    expect(mockRunClaude).toHaveBeenCalledOnce();
    expect(pool.submitTask).not.toHaveBeenCalled();
  });

  it("falls back to runClaude when no worker pool is provided", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const coordinator = new Coordinator(true);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("completed");
    expect(mockRunClaude).toHaveBeenCalledOnce();
  });

  it("marks task as failed when worker pool throws", async () => {
    const pool: WorkerPool = {
      isAvailable: vi.fn().mockReturnValue(true),
      submitTask: vi.fn().mockRejectedValue(new Error("pool error")),
    };
    const coordinator = new Coordinator(true, pool);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("pool error");
  });
});

describe("Coordinator — getStatus", () => {
  beforeEach(() => {
    mockRunClaude.mockReset();
  });

  it("returns pending immediately after submitTask", async () => {
    // Never resolves during this check
    mockRunClaude.mockReturnValue(new Promise(() => undefined));
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    const status = coordinator.getStatus(taskId);

    expect(status).toBeDefined();
    expect(["pending", "running"]).toContain(status!.status);
  });

  it("returns undefined for unknown task id", () => {
    const coordinator = new Coordinator(false);
    expect(coordinator.getStatus("no-such-id")).toBeUndefined();
  });

  it("returns completed after waitForCompletion resolves", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    await coordinator.waitForCompletion(taskId);

    expect(coordinator.getStatus(taskId)?.status).toBe("completed");
  });
});

describe("Coordinator — waitForCompletion edge cases", () => {
  beforeEach(() => {
    mockRunClaude.mockReset();
  });

  it("returns failed result for unknown task", async () => {
    const coordinator = new Coordinator(false);
    const result = await coordinator.waitForCompletion("unknown-id");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Unknown task");
  });

  it("resolves immediately for already-completed task", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    await coordinator.waitForCompletion(taskId);

    // Second wait should also resolve
    const result = await coordinator.waitForCompletion(taskId);
    expect(result.status).toBe("completed");
  });

  it("multiple waiters receive the same result", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    const [r1, r2] = await Promise.all([
      coordinator.waitForCompletion(taskId),
      coordinator.waitForCompletion(taskId),
    ]);

    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("completed");
    expect(r1.taskId).toBe(r2.taskId);
  });

  it("records completedAt and durationMs on success", async () => {
    mockRunClaude.mockResolvedValue(successResult);
    const coordinator = new Coordinator(false);

    const taskId = await coordinator.submitTask(baseOptions);
    const result = await coordinator.waitForCompletion(taskId);

    expect(result.completedAt).toBeTruthy();
    expect(result.durationMs).toBe(successResult.durationMs);
  });
});
