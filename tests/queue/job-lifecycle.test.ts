import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobLifecycle, type JobHandler } from "../../src/queue/job-lifecycle.js";
import type { JobStore } from "../../src/queue/job-store.js";
import type { ProjectErrorTracker } from "../../src/queue/project-error-tracker.js";
import type { TaskFactory } from "../../src/tasks/task-factory.js";
import type { AQMTask } from "../../src/tasks/aqm-task.js";
import type { Job } from "../../src/types/pipeline.js";

function makeStore(): JobStore {
  return {
    update: vi.fn(),
  } as unknown as JobStore;
}

function makeTracker(): ProjectErrorTracker {
  return {
    trackFailure: vi.fn(),
    trackSuccess: vi.fn(),
  } as unknown as ProjectErrorTracker;
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    issueNumber: 1,
    repo: "a/b",
    status: "running",
    createdAt: "2025-01-01T00:00:00.000Z",
    lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    startedAt: "2025-01-01T00:00:00.000Z",
    logs: [],
    currentStep: null,
    ...overrides,
  } as unknown as Job;
}

describe("JobLifecycle", () => {
  let store: JobStore;
  let errorTracker: ProjectErrorTracker;
  let activeTasks: Map<string, AQMTask>;
  let stuckAborted: Set<string>;
  let cancelled: Set<string>;
  let onJobFinished: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = makeStore();
    errorTracker = makeTracker();
    activeTasks = new Map();
    stuckAborted = new Set();
    cancelled = new Set();
    onJobFinished = vi.fn();
  });

  function makeLifecycle(handler: JobHandler, taskFactory?: TaskFactory) {
    return new JobLifecycle({
      store,
      handler,
      taskFactory,
      errorTracker,
      activeTasks,
      stuckAborted,
      cancelled,
      onJobFinished,
    });
  }

  it("성공 결과(prUrl)는 success로 update + trackSuccess", async () => {
    const handler: JobHandler = vi.fn(async () => ({ prUrl: "https://github.com/x/y/pull/1" }));
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(handler).toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "success", prUrl: "https://github.com/x/y/pull/1" })
    );
    expect(errorTracker.trackSuccess).toHaveBeenCalledWith("a/b");
    expect(errorTracker.trackFailure).not.toHaveBeenCalled();
    expect(onJobFinished).toHaveBeenCalledWith("job-1", "a/b");
  });

  it("error 결과는 failure로 update + trackFailure + diagnosis/userSummary 전파", async () => {
    const handler: JobHandler = vi.fn(async () => ({
      error: "boom",
      diagnosis: { rootCause: "x" } as never,
      userSummary: { headline: "y" } as never,
    }));
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "failure",
        error: "boom",
        diagnosis: { rootCause: "x" },
        userSummary: { headline: "y" },
      })
    );
    expect(errorTracker.trackFailure).toHaveBeenCalledWith("a/b");
    expect(onJobFinished).toHaveBeenCalledWith("job-1", "a/b");
  });

  it("prUrl도 error도 없으면 'no PR was created' 실패", async () => {
    const handler: JobHandler = vi.fn(async () => ({}));
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "failure",
        error: "Pipeline completed but no PR was created",
      })
    );
    expect(errorTracker.trackFailure).toHaveBeenCalledWith("a/b");
  });

  it("실행 시작 시 stuckAborted면 handler 호출하지 않고 종료(onJobFinished는 호출됨)", async () => {
    stuckAborted.add("job-1");
    const handler: JobHandler = vi.fn();
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(handler).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
    expect(stuckAborted.has("job-1")).toBe(false); // 플래그 클리어
    expect(onJobFinished).toHaveBeenCalledWith("job-1", "a/b");
  });

  it("handler 도중 stuckAborted 발화 시 status update는 하되 trackFailure 스킵", async () => {
    const handler: JobHandler = vi.fn(async () => {
      stuckAborted.add("job-1");
      return { error: "boom" };
    });
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "failure", error: "boom" })
    );
    expect(errorTracker.trackFailure).not.toHaveBeenCalled();
    expect(stuckAborted.has("job-1")).toBe(false);
  });

  it("cancelled 플래그 set 상태에서 handler가 끝나면 store update 스킵 + 플래그 클리어", async () => {
    const handler: JobHandler = vi.fn(async () => {
      cancelled.add("job-1");
      return { prUrl: "ignored" };
    });
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(store.update).not.toHaveBeenCalled();
    expect(cancelled.has("job-1")).toBe(false);
    expect(onJobFinished).toHaveBeenCalledWith("job-1", "a/b");
  });

  it("handler 예외 발생 시 failure로 update + trackFailure + onJobFinished 보장", async () => {
    const handler: JobHandler = vi.fn(async () => {
      throw new Error("kaboom");
    });
    const lifecycle = makeLifecycle(handler);

    await lifecycle.execute(makeJob());

    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "failure", error: "kaboom" })
    );
    expect(errorTracker.trackFailure).toHaveBeenCalledWith("a/b");
    expect(onJobFinished).toHaveBeenCalledWith("job-1", "a/b");
  });

  it("taskFactory 경로: createTask로 만든 task.run()을 호출하고 activeTasks에 추가/제거", async () => {
    const runMock = vi.fn(async () => ({ prUrl: "https://x" }));
    const killMock = vi.fn();
    const fakeTask = { run: runMock, kill: killMock } as unknown as AQMTask;
    const taskFactory = {
      createTask: vi.fn(() => fakeTask),
    } as unknown as TaskFactory;

    const handler: JobHandler = vi.fn();
    const lifecycle = makeLifecycle(handler, taskFactory);

    const finishedActiveTasks: Map<string, AQMTask>[] = [];
    onJobFinished.mockImplementation(() => {
      finishedActiveTasks.push(new Map(activeTasks));
    });

    await lifecycle.execute(makeJob());

    expect(taskFactory.createTask).toHaveBeenCalled();
    expect(runMock).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(activeTasks.has("job-1")).toBe(false); // run 후 제거
    // onJobFinished 시점에도 이미 빠져 있어야 함
    expect(finishedActiveTasks[0]?.has("job-1")).toBe(false);
    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "success", prUrl: "https://x" })
    );
  });

  it("taskFactory.run()이 throw해도 activeTasks 정리 + onJobFinished 호출", async () => {
    const runMock = vi.fn(async () => {
      throw new Error("task-boom");
    });
    const fakeTask = { run: runMock, kill: vi.fn() } as unknown as AQMTask;
    const taskFactory = {
      createTask: vi.fn(() => fakeTask),
    } as unknown as TaskFactory;

    const lifecycle = makeLifecycle(vi.fn(), taskFactory);

    await lifecycle.execute(makeJob());

    expect(activeTasks.has("job-1")).toBe(false);
    expect(store.update).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "failure", error: "task-boom" })
    );
    expect(errorTracker.trackFailure).toHaveBeenCalledWith("a/b");
    expect(onJobFinished).toHaveBeenCalledWith("job-1", "a/b");
  });
});
