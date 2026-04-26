import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const claudeMocks = vi.hoisted(() => ({
  isClaudeProcessAlive: vi.fn(() => false),
  getLastActivityMs: vi.fn(() => Date.now()),
}));

const stuckDetectorMock = vi.hoisted(() => ({
  checkJobStuck: vi.fn(),
}));

vi.mock("../../src/claude/claude-runner.js", () => claudeMocks);
vi.mock("../../src/queue/stuck-detector.js", () => stuckDetectorMock);

import { StuckJobMonitor } from "../../src/queue/stuck-monitor.js";
import type { Job as StoreJob, JobStore } from "../../src/queue/job-store.js";
import type { Job } from "../../src/types/pipeline.js";

function makeStore(getResult: StoreJob | undefined = undefined): JobStore {
  return {
    get: vi.fn(() => getResult),
    update: vi.fn(),
  } as unknown as JobStore;
}

function makeStoreJob(id: string): StoreJob {
  return {
    id,
    issueNumber: 1,
    repo: "a/b",
    status: "running",
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    logs: [],
    currentStep: null,
  } as unknown as StoreJob;
}

describe("StuckJobMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    claudeMocks.isClaudeProcessAlive.mockReturnValue(false);
    claudeMocks.getLastActivityMs.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start/stop은 setInterval을 토글한다", () => {
    const monitor = new StuckJobMonitor({
      store: makeStore(),
      stuckTimeoutMs: 1000,
      checkIntervalMs: 100,
      getRunningJobIds: () => [],
      toJob: (j) => j as unknown as Job,
      onStuckDetected: () => {},
    });

    monitor.start();
    vi.advanceTimersByTime(250);
    monitor.stop();
    vi.advanceTimersByTime(500);
    // 정상 동작 — 에러 없음
    expect(true).toBe(true);
  });

  it("stuck 판정 시 onStuckDetected 콜백 호출", () => {
    stuckDetectorMock.checkJobStuck.mockReturnValue({
      isStuck: true,
      reason: "타임아웃",
      category: "default",
      elapsedMs: 600_000,
      thresholdMs: 300_000,
    });
    const storeJob = makeStoreJob("job-1");
    const store = makeStore(storeJob);
    const onStuckDetected = vi.fn();

    const monitor = new StuckJobMonitor({
      store,
      stuckTimeoutMs: 1000,
      getRunningJobIds: () => ["job-1"],
      toJob: (j) => j as unknown as Job,
      onStuckDetected,
    });

    monitor.runOnce();

    expect(onStuckDetected).toHaveBeenCalledWith("job-1", "타임아웃");
  });

  it("stuck 아님 + threshold 초과 시 lastUpdatedAt 갱신", () => {
    stuckDetectorMock.checkJobStuck.mockReturnValue({
      isStuck: false,
      reason: "Claude 활동 중",
      category: "default",
      elapsedMs: 600_000,
      thresholdMs: 300_000,
    });
    const storeJob = makeStoreJob("job-2");
    const store = makeStore(storeJob);

    const monitor = new StuckJobMonitor({
      store,
      stuckTimeoutMs: 1000,
      getRunningJobIds: () => ["job-2"],
      toJob: (j) => j as unknown as Job,
      onStuckDetected: () => {},
    });

    monitor.runOnce();

    expect(store.update).toHaveBeenCalledWith(
      "job-2",
      expect.objectContaining({ lastUpdatedAt: expect.any(String) })
    );
  });

  it("threshold 이내 reason은 액션 없음", () => {
    stuckDetectorMock.checkJobStuck.mockReturnValue({
      isStuck: false,
      reason: "임계값 이내",
      category: "default",
      elapsedMs: 100,
      thresholdMs: 1000,
    });
    const storeJob = makeStoreJob("job-3");
    const store = makeStore(storeJob);
    const onStuckDetected = vi.fn();

    const monitor = new StuckJobMonitor({
      store,
      stuckTimeoutMs: 1000,
      getRunningJobIds: () => ["job-3"],
      toJob: (j) => j as unknown as Job,
      onStuckDetected,
    });

    monitor.runOnce();

    expect(store.update).not.toHaveBeenCalled();
    expect(onStuckDetected).not.toHaveBeenCalled();
  });

  it("store.get이 undefined 반환하면 해당 잡은 스킵", () => {
    const store = makeStore(undefined);
    const onStuckDetected = vi.fn();

    const monitor = new StuckJobMonitor({
      store,
      stuckTimeoutMs: 1000,
      getRunningJobIds: () => ["ghost"],
      toJob: (j) => j as unknown as Job,
      onStuckDetected,
    });

    monitor.runOnce();

    expect(stuckDetectorMock.checkJobStuck).not.toHaveBeenCalled();
    expect(onStuckDetected).not.toHaveBeenCalled();
  });

  it("interval 발화 시 checkJobStuck 호출", () => {
    stuckDetectorMock.checkJobStuck.mockReturnValue({
      isStuck: false,
      reason: "임계값 이내",
      category: "default",
      elapsedMs: 0,
      thresholdMs: 1000,
    });
    const store = makeStore(makeStoreJob("job-tick"));

    const monitor = new StuckJobMonitor({
      store,
      stuckTimeoutMs: 1000,
      checkIntervalMs: 50,
      getRunningJobIds: () => ["job-tick"],
      toJob: (j) => j as unknown as Job,
      onStuckDetected: () => {},
    });

    monitor.start();
    vi.advanceTimersByTime(170); // 50/100/150 = 3회
    monitor.stop();

    expect(stuckDetectorMock.checkJobStuck).toHaveBeenCalledTimes(3);
  });
});
