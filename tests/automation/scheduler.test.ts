import { describe, it, expect, vi, beforeEach } from "vitest";

// node-cron mock — schedule된 Job 객체를 제어 가능하게 만든다
const mockCronStart = vi.fn();
const mockCronStop = vi.fn();

// 등록된 콜백을 테스트에서 직접 트리거하기 위해 보관
let capturedCallbacks: Array<() => Promise<void>> = [];

vi.mock("node-cron", () => ({
  default: {
    validate: vi.fn((expr: string) => expr !== "invalid"),
    schedule: vi.fn((_expr: string, callback: () => Promise<void>, _opts: unknown) => {
      capturedCallbacks.push(callback);
      return { start: mockCronStart, stop: mockCronStop };
    }),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

import { AutomationScheduler } from "../../src/automation/scheduler.js";
import type { ScheduledTask } from "../../src/types/automation.js";

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    name: "Test Task",
    schedule: { expression: "0 9 * * *" },
    status: "idle",
    runCount: 0,
    ...overrides,
  };
}

describe("AutomationScheduler", () => {
  let scheduler: AutomationScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks = [];
    scheduler = new AutomationScheduler();
  });

  // ─── start / stop ────────────────────────────────────────────────────────

  describe("start / stop", () => {
    it("isRunning()은 초기에 false", () => {
      expect(scheduler.isRunning()).toBe(false);
    });

    it("start() 후 isRunning()은 true", () => {
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it("stop() 후 isRunning()은 false", () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("start()를 두 번 호출해도 cronJob.start()는 한 번만", () => {
      const task = makeTask();
      scheduler.addTask(task, vi.fn());
      scheduler.start();
      scheduler.start(); // 두 번째 호출 — 무시
      expect(mockCronStart).toHaveBeenCalledTimes(1);
    });

    it("stop()을 두 번 호출해도 cronJob.stop()은 한 번만", () => {
      const task = makeTask();
      scheduler.addTask(task, vi.fn());
      scheduler.start();
      scheduler.stop();
      const stopCountAfterFirst = mockCronStop.mock.calls.length;
      scheduler.stop(); // 두 번째 호출 — 무시
      expect(mockCronStop.mock.calls.length).toBe(stopCountAfterFirst);
    });

    it("start() 시 등록된 active 태스크의 cronJob.start() 호출", () => {
      scheduler.addTask(makeTask({ id: "t1" }), vi.fn());
      scheduler.addTask(makeTask({ id: "t2" }), vi.fn());
      scheduler.start();
      expect(mockCronStart).toHaveBeenCalledTimes(2);
    });

    it("stop() 시 모든 cronJob.stop() 호출", () => {
      scheduler.addTask(makeTask({ id: "t1" }), vi.fn());
      scheduler.addTask(makeTask({ id: "t2" }), vi.fn());
      scheduler.start();
      mockCronStop.mockClear();
      scheduler.stop();
      expect(mockCronStop).toHaveBeenCalledTimes(2);
    });

    it("start() 시 disabled 태스크는 cronJob.start() 호출 안 함", () => {
      scheduler.addTask(makeTask({ id: "t1", status: "disabled" }), vi.fn());
      scheduler.start();
      expect(mockCronStart).not.toHaveBeenCalled();
    });
  });

  // ─── addTask ─────────────────────────────────────────────────────────────

  describe("addTask", () => {
    it("태스크 등록 후 getTask()로 조회 가능", () => {
      const task = makeTask();
      scheduler.addTask(task, vi.fn());
      const stored = scheduler.getTask("task-1");
      expect(stored).toBeDefined();
      expect(stored?.id).toBe("task-1");
      expect(stored?.name).toBe("Test Task");
    });

    it("동일 id 재등록 시 기존 태스크 덮어쓰기", () => {
      scheduler.addTask(makeTask({ name: "Old" }), vi.fn());
      scheduler.addTask(makeTask({ name: "New" }), vi.fn());
      expect(scheduler.getTask("task-1")?.name).toBe("New");
      expect(scheduler.getTasks()).toHaveLength(1);
    });

    it("유효하지 않은 cron 표현식은 에러 throw", () => {
      const task = makeTask({ schedule: { expression: "invalid" } });
      expect(() => scheduler.addTask(task, vi.fn())).toThrow(/유효하지 않은 cron 표현식/);
    });

    it("스케줄러 실행 중 addTask하면 cronJob.start() 즉시 호출", () => {
      scheduler.start();
      scheduler.addTask(makeTask(), vi.fn());
      expect(mockCronStart).toHaveBeenCalled();
    });

    it("스케줄러 실행 중 disabled 태스크 addTask하면 cronJob.start() 미호출", () => {
      scheduler.start();
      scheduler.addTask(makeTask({ status: "disabled" }), vi.fn());
      expect(mockCronStart).not.toHaveBeenCalled();
    });

    it("스케줄러 미실행 상태에서 addTask하면 cronJob.start() 미호출", () => {
      scheduler.addTask(makeTask(), vi.fn());
      expect(mockCronStart).not.toHaveBeenCalled();
    });
  });

  // ─── removeTask ──────────────────────────────────────────────────────────

  describe("removeTask", () => {
    it("등록된 태스크 제거 후 getTask() undefined 반환", () => {
      scheduler.addTask(makeTask(), vi.fn());
      scheduler.removeTask("task-1");
      expect(scheduler.getTask("task-1")).toBeUndefined();
    });

    it("제거 시 cronJob.stop() 호출", () => {
      scheduler.addTask(makeTask(), vi.fn());
      scheduler.removeTask("task-1");
      expect(mockCronStop).toHaveBeenCalledTimes(1);
    });

    it("존재하지 않는 id 제거 시 에러 없음", () => {
      expect(() => scheduler.removeTask("nonexistent")).not.toThrow();
    });
  });

  // ─── getTasks / getState ──────────────────────────────────────────────────

  describe("getTasks / getState", () => {
    it("getTasks()는 등록된 모든 태스크 반환", () => {
      scheduler.addTask(makeTask({ id: "t1" }), vi.fn());
      scheduler.addTask(makeTask({ id: "t2" }), vi.fn());
      expect(scheduler.getTasks()).toHaveLength(2);
    });

    it("getTasks()는 복사본 반환 — 원본 변경 불가", () => {
      const task = makeTask();
      scheduler.addTask(task, vi.fn());
      const tasks = scheduler.getTasks();
      tasks[0].name = "mutated";
      expect(scheduler.getTask("task-1")?.name).toBe("Test Task");
    });

    it("getState()는 tasks 배열과 running 상태 반환", () => {
      scheduler.addTask(makeTask(), vi.fn());
      scheduler.start();
      const state = scheduler.getState();
      expect(state.running).toBe(true);
      expect(state.tasks).toHaveLength(1);
    });
  });

  // ─── cron 트리거 (runTask) ────────────────────────────────────────────────

  describe("cron 트리거", () => {
    it("cron 콜백 실행 시 callback이 호출됨", async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.addTask(makeTask(), callback);

      // node-cron이 등록한 콜백을 직접 트리거
      expect(capturedCallbacks).toHaveLength(1);
      await capturedCallbacks[0]();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("실행 후 태스크 상태가 idle로 복귀하고 runCount 증가", async () => {
      scheduler.addTask(makeTask(), vi.fn().mockResolvedValue(undefined));
      await capturedCallbacks[0]();

      const task = scheduler.getTask("task-1");
      expect(task?.status).toBe("idle");
      expect(task?.runCount).toBe(1);
      expect(task?.lastRunAt).toBeDefined();
    });

    it("callback 실패 시 태스크 상태가 failed이고 lastError 설정", async () => {
      const callback = vi.fn().mockRejectedValue(new Error("callback error"));
      scheduler.addTask(makeTask(), callback);
      await capturedCallbacks[0]();

      const task = scheduler.getTask("task-1");
      expect(task?.status).toBe("failed");
      expect(task?.lastError).toBe("callback error");
      expect(task?.runCount).toBe(1);
    });

    it("태스크 이미 running 상태면 중복 실행 건너뜀", async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.addTask(makeTask(), callback);

      // 내부 상태를 직접 running으로 변경
      const entry = (scheduler as unknown as { tasks: Map<string, { task: ScheduledTask }> }).tasks.get("task-1");
      if (entry) entry.task.status = "running";

      await capturedCallbacks[0]();
      expect(callback).not.toHaveBeenCalled();
    });

    it("성공 실행 후 lastError는 undefined로 클리어", async () => {
      const task = makeTask({ lastError: "previous error", status: "failed" });
      scheduler.addTask(task, vi.fn().mockResolvedValue(undefined));
      await capturedCallbacks[0]();

      expect(scheduler.getTask("task-1")?.lastError).toBeUndefined();
    });
  });
});
