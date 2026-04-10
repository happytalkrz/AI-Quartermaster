import { describe, it, expect, vi } from "vitest";
import { DefaultTaskFactory } from "../../src/tasks/task-factory.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { Job } from "../../src/types/pipeline.js";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    issueNumber: 42,
    repo: "test/repo",
    status: "running",
    startedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    logs: [],
    currentStep: undefined,
    dependencies: [],
    phaseResults: undefined,
    progress: undefined,
    isRetry: false,
    costUsd: undefined,
    totalCostUsd: undefined,
    totalUsage: undefined,
    ...overrides,
  } as unknown as Job;
}

describe("DefaultTaskFactory", () => {
  it("createTask returns a task with matching job id", () => {
    const handler = vi.fn().mockResolvedValue({ prUrl: "https://pr/1" });
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job);
    expect(task.id).toBe(job.id);
    expect(task.type).toBe("claude");
    expect(task.status).toBe(TaskStatus.PENDING);
  });

  it("task.run() calls handler and returns result", async () => {
    const handler = vi.fn().mockResolvedValue({ prUrl: "https://pr/2" });
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job) as unknown as { run(): Promise<{ prUrl?: string; error?: string }> };
    const result = await task.run();
    expect(handler).toHaveBeenCalledWith(job);
    expect(result).toEqual({ prUrl: "https://pr/2" });
  });

  it("task status transitions: PENDING -> RUNNING -> SUCCESS", async () => {
    const handler = vi.fn().mockResolvedValue({ prUrl: "https://pr/3" });
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job);
    expect(task.status).toBe(TaskStatus.PENDING);
    const runPromise = (task as unknown as { run(): Promise<unknown> }).run();
    await runPromise;
    expect(task.status).toBe(TaskStatus.SUCCESS);
  });

  it("task status is FAILED when handler returns error", async () => {
    const handler = vi.fn().mockResolvedValue({ error: "something went wrong" });
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job);
    await (task as unknown as { run(): Promise<unknown> }).run();
    expect(task.status).toBe(TaskStatus.FAILED);
  });

  it("task status is FAILED when handler throws", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job);
    await expect(
      (task as unknown as { run(): Promise<unknown> }).run()
    ).rejects.toThrow("boom");
    expect(task.status).toBe(TaskStatus.FAILED);
  });

  it("task.kill() sets status to KILLED", async () => {
    let resolveHandler!: (v: { prUrl?: string; error?: string }) => void;
    const handler = vi.fn().mockReturnValue(
      new Promise<{ prUrl?: string; error?: string }>(res => { resolveHandler = res; })
    );
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job);
    // start running in background
    const runPromise = (task as unknown as { run(): Promise<unknown> }).run();
    // kill while running
    await task.kill();
    expect(task.status).toBe(TaskStatus.KILLED);
    // resolve handler so run() can finish
    resolveHandler({ prUrl: "https://pr/x" });
    await runPromise.catch(() => {}); // status already set to KILLED
  });

  it("toJSON returns correct shape", async () => {
    const handler = vi.fn().mockResolvedValue({ prUrl: "https://pr/4" });
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob({ id: "j-42", issueNumber: 7, repo: "org/repo" });
    const task = factory.createTask(job);
    await (task as unknown as { run(): Promise<unknown> }).run();
    const json = task.toJSON();
    expect(json.id).toBe("j-42");
    expect(json.type).toBe("claude");
    expect(json.status).toBe(TaskStatus.SUCCESS);
    expect(json.startedAt).toBeDefined();
    expect(json.completedAt).toBeDefined();
    expect(typeof json.durationMs).toBe("number");
    expect(json.metadata?.jobId).toBe("j-42");
    expect(json.metadata?.issueNumber).toBe(7);
    expect(json.metadata?.repo).toBe("org/repo");
  });

  it("createTask cannot run the same task twice", async () => {
    const handler = vi.fn().mockResolvedValue({ prUrl: "https://pr/5" });
    const factory = new DefaultTaskFactory(handler);
    const job = makeJob();
    const task = factory.createTask(job);
    await (task as unknown as { run(): Promise<unknown> }).run();
    await expect(
      (task as unknown as { run(): Promise<unknown> }).run()
    ).rejects.toThrow();
  });
});
