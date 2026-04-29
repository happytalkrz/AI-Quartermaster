import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobScheduler } from "../../src/queue/job-scheduler.js";
import type { JobStore, Job as StoreJob } from "../../src/queue/job-store.js";
import type { ProjectErrorTracker } from "../../src/queue/project-error-tracker.js";

function makeStoreJob(overrides: Partial<StoreJob> = {}): StoreJob {
  return {
    id: "job-x",
    issueNumber: 1,
    repo: "a/b",
    status: "queued",
    createdAt: "2025-01-01T00:00:00.000Z",
    lastUpdatedAt: "2025-01-01T00:00:00.000Z",
    logs: [],
    currentStep: null,
    ...overrides,
  } as unknown as StoreJob;
}

function makeStore(jobs: Record<string, StoreJob> = {}): JobStore {
  return {
    isClosed: false,
    get: vi.fn((id: string) => jobs[id]),
    update: vi.fn(),
    findAnyByIssue: vi.fn(),
    findCompletedByIssue: vi.fn(() => undefined),
  } as unknown as JobStore;
}

function makeTracker(paused = new Set<string>()): ProjectErrorTracker {
  return {
    isProjectPaused: vi.fn((repo: string) => paused.has(repo)),
    getProjectStatus: vi.fn((repo: string) =>
      paused.has(repo) ? { pausedUntil: Date.now() + 60_000 } : null
    ),
  } as unknown as ProjectErrorTracker;
}

describe("JobScheduler", () => {
  let cancelled: Set<string>;
  let onStartJob: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cancelled = new Set();
    onStartJob = vi.fn();
  });

  it("enqueue → onStartJob 호출 + running.size 증가 + store.update(running)", async () => {
    const j = makeStoreJob({ id: "j1" });
    const store = makeStore({ j1: j });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).toHaveBeenCalledWith(j);
    expect(scheduler.runningCount).toBe(1);
    expect(scheduler.isRunning("j1")).toBe(true);
    expect(store.update).toHaveBeenCalledWith(
      "j1",
      expect.objectContaining({ status: "running" })
    );
  });

  it("concurrency 한도 초과 시 pending 유지", async () => {
    const j1 = makeStoreJob({ id: "j1", repo: "a/b" });
    const j2 = makeStoreJob({ id: "j2", repo: "c/d" });
    const store = makeStore({ j1, j2 });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    scheduler.enqueue("j2");
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toEqual({ pending: 1, running: 1, concurrency: 1 });
  });

  it("markJobFinished로 슬롯 해제 시 다음 잡 시작", async () => {
    const j1 = makeStoreJob({ id: "j1", repo: "a/b" });
    const j2 = makeStoreJob({ id: "j2", repo: "c/d" });
    const store = makeStore({ j1, j2 });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    scheduler.enqueue("j2");
    await new Promise((r) => setImmediate(r));
    expect(onStartJob).toHaveBeenCalledTimes(1);

    scheduler.markJobFinished("j1", "a/b");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).toHaveBeenCalledTimes(2);
    expect(scheduler.runningCount).toBe(1);
    expect(scheduler.isRunning("j2")).toBe(true);
  });

  it("removePending: pending에서 제거 후 onStartJob 호출 안 됨", async () => {
    const j = makeStoreJob({ id: "j1" });
    const store = makeStore({ j1: j });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 0, // 즉시 처리 안 됨
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.pushPending("j1");
    expect(scheduler.removePending("j1")).toBe(true);
    expect(scheduler.removePending("j1")).toBe(false);
    expect(onStartJob).not.toHaveBeenCalled();
  });

  it("cancelledRef에 미리 set된 잡은 onStartJob 호출 안 됨 + 플래그 클리어", async () => {
    const j = makeStoreJob({ id: "j1" });
    const store = makeStore({ j1: j });
    cancelled.add("j1");
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).not.toHaveBeenCalled();
    expect(cancelled.has("j1")).toBe(false);
  });

  it("project pause 상태면 잡을 deferred 처리 (다음 호출에 다시 시도)", async () => {
    const j = makeStoreJob({ id: "j1", repo: "paused/repo" });
    const store = makeStore({ j1: j });
    const paused = new Set(["paused/repo"]);
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(paused),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).not.toHaveBeenCalled();
    expect(scheduler.getStatus().pending).toBe(1);
  });

  it("setProjectConcurrency 0이면 다음 잡은 시작 안 됨, null이면 제한 해제", async () => {
    const j1 = makeStoreJob({ id: "j1", repo: "r1" });
    const j2 = makeStoreJob({ id: "j2", repo: "r1" });
    const store = makeStore({ j1, j2 });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 5,
      projectConcurrency: { r1: 1 },
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    scheduler.enqueue("j2");
    await new Promise((r) => setImmediate(r));

    // r1 제한 1 → j1만 시작
    expect(onStartJob).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus().pending).toBe(1);

    scheduler.setProjectConcurrency("r1", null);
    await new Promise((r) => setImmediate(r));

    // 제한 해제 → j2 시작
    expect(onStartJob).toHaveBeenCalledTimes(2);
  });

  it("setConcurrency: 양수 정수가 아니면 throw", () => {
    const scheduler = new JobScheduler({
      store: makeStore(),
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });
    expect(() => scheduler.setConcurrency(0)).toThrow();
    expect(() => scheduler.setConcurrency(-1)).toThrow();
    expect(() => scheduler.setConcurrency(1.5)).toThrow();
  });

  it("dependency 미충족이면 deferred", async () => {
    const j1 = makeStoreJob({ id: "j1", repo: "r1", dependencies: [99] });
    const store = makeStore({ j1 });
    (store.findAnyByIssue as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.enqueue("j1");
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).not.toHaveBeenCalled();
    expect(scheduler.getStatus().pending).toBe(1);
  });

  it("round-robin: 다른 repo 잡을 번갈아 서빙", async () => {
    const j1a = makeStoreJob({ id: "j1a", repo: "A", createdAt: "2025-01-01T00:00:00Z" });
    const j1b = makeStoreJob({ id: "j1b", repo: "A", createdAt: "2025-01-01T00:00:01Z" });
    const j2a = makeStoreJob({ id: "j2a", repo: "B", createdAt: "2025-01-01T00:00:02Z" });
    const store = makeStore({ j1a, j1b, j2a });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.pushPending("j1a");
    scheduler.pushPending("j1b");
    scheduler.pushPending("j2a");
    void scheduler.processNext();
    await new Promise((r) => setImmediate(r));

    // 첫 잡: A repo의 가장 빠른 j1a
    expect(onStartJob).toHaveBeenNthCalledWith(1, j1a);

    scheduler.markJobFinished("j1a", "A");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // 다음 잡: 다른 repo B의 j2a (round-robin)
    expect(onStartJob).toHaveBeenNthCalledWith(2, j2a);
  });

  it("priority: high가 normal보다 먼저", async () => {
    const jHigh = makeStoreJob({ id: "jH", repo: "X", priority: "high", createdAt: "2025-01-01T00:00:01Z" } as Partial<StoreJob>);
    const jNorm = makeStoreJob({ id: "jN", repo: "X", priority: "normal", createdAt: "2025-01-01T00:00:00Z" } as Partial<StoreJob>);
    const store = makeStore({ jH: jHigh, jN: jNorm });
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });

    scheduler.pushPending("jN");
    scheduler.pushPending("jH");
    void scheduler.processNext();
    await new Promise((r) => setImmediate(r));

    expect(onStartJob).toHaveBeenNthCalledWith(1, jHigh);
  });

  it("store.isClosed면 processNext no-op", async () => {
    const store = makeStore();
    (store as unknown as { isClosed: boolean }).isClosed = true;
    const scheduler = new JobScheduler({
      store,
      errorTracker: makeTracker(),
      concurrency: 1,
      cancelledRef: cancelled,
      onStartJob,
    });
    scheduler.pushPending("any");
    await scheduler.processNext();
    expect(onStartJob).not.toHaveBeenCalled();
  });
});
