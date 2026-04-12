import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Coordinator, CoordinatorConfig } from "../../src/claude/coordinator.js";
import { WorkerPool } from "../../src/claude/worker-pool.js";

// WorkerPool 클래스를 mock하여 생성자 인수와 메서드 호출을 검증한다
vi.mock("../../src/claude/worker-pool.js");
vi.mock("../../src/utils/cli-runner.js", () => ({
  runCli: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
}));

const makeConfig = (overrides: Partial<CoordinatorConfig> = {}): CoordinatorConfig => ({
  maxWorkers: 2,
  claudeCliPath: "claude",
  defaultModel: "claude-sonnet",
  timeout: 5000,
  ...overrides,
});

/** WorkerPool mock 인스턴스를 생성하고 vi.mocked(WorkerPool)이 반환하도록 설정한다 */
function makePoolMock(maxWorkers = 2) {
  const instance = {
    submit: vi.fn().mockResolvedValue({ taskId: "t1", workerId: "worker-1", output: "ok", success: true, duration: 0 }),
    getStatus: vi.fn().mockReturnValue({ maxWorkers, busy: 0, idle: 0, pending: 0 }),
    getWorkers: vi.fn().mockReturnValue([]),
    setMaxWorkers: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(WorkerPool).mockImplementation(() => instance as any);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// Constructor — WorkerPool 생성자 인수 검증
// ────────────────────────────────────────────────────────────
describe("Coordinator constructor - WorkerPool 인수 전달", () => {
  it("maxWorkers를 WorkerPool에 전달한다", () => {
    makePoolMock(3);
    new Coordinator(makeConfig({ maxWorkers: 3 }));
    expect(vi.mocked(WorkerPool)).toHaveBeenCalledWith(
      3,
      expect.any(Function),
      undefined
    );
  });

  it("workerPool 옵션(idleTimeoutMs, minWorkers)을 WorkerPool에 전달한다", () => {
    makePoolMock();
    const workerPoolOptions = { idleTimeoutMs: 5000, minWorkers: 1 };
    new Coordinator(makeConfig({ workerPool: workerPoolOptions }));
    expect(vi.mocked(WorkerPool)).toHaveBeenCalledWith(
      2,
      expect.any(Function),
      workerPoolOptions
    );
  });

  it("workerPool 미설정 시 undefined를 WorkerPool에 전달한다", () => {
    makePoolMock();
    new Coordinator(makeConfig());
    expect(vi.mocked(WorkerPool)).toHaveBeenCalledWith(
      2,
      expect.any(Function),
      undefined
    );
  });

  it("workerPool.idleTimeoutMs만 설정해도 전달된다", () => {
    makePoolMock();
    new Coordinator(makeConfig({ workerPool: { idleTimeoutMs: 10000, minWorkers: 0 } }));
    expect(vi.mocked(WorkerPool)).toHaveBeenCalledWith(
      2,
      expect.any(Function),
      { idleTimeoutMs: 10000, minWorkers: 0 }
    );
  });

  it("workerPool.minWorkers만 설정해도 전달된다 (idleTimeoutMs 없음 = shrink 비활성화)", () => {
    makePoolMock();
    new Coordinator(makeConfig({ workerPool: { minWorkers: 2 } }));
    expect(vi.mocked(WorkerPool)).toHaveBeenCalledWith(
      2,
      expect.any(Function),
      { minWorkers: 2 }
    );
  });
});

// ────────────────────────────────────────────────────────────
// getPoolStatus / getWorkers
// ────────────────────────────────────────────────────────────
describe("Coordinator getPoolStatus", () => {
  it("WorkerPool.getStatus() 결과를 반환한다", () => {
    const pool = makePoolMock(4);
    pool.getStatus.mockReturnValue({ maxWorkers: 4, busy: 1, idle: 2, pending: 3 });
    const coordinator = new Coordinator(makeConfig({ maxWorkers: 4 }));

    expect(coordinator.getPoolStatus()).toEqual({ maxWorkers: 4, busy: 1, idle: 2, pending: 3 });
    expect(pool.getStatus).toHaveBeenCalledTimes(1);
  });
});

describe("Coordinator getWorkers", () => {
  it("WorkerPool.getWorkers() 결과를 반환한다", () => {
    const pool = makePoolMock();
    const fakeWorkers = [{ id: "worker-1", status: "idle" as const }];
    pool.getWorkers.mockReturnValue(fakeWorkers);
    const coordinator = new Coordinator(makeConfig());

    expect(coordinator.getWorkers()).toBe(fakeWorkers);
  });
});

// ────────────────────────────────────────────────────────────
// setMaxWorkers
// ────────────────────────────────────────────────────────────
describe("Coordinator setMaxWorkers", () => {
  it("WorkerPool.setMaxWorkers()를 호출한다", () => {
    const pool = makePoolMock();
    const coordinator = new Coordinator(makeConfig());
    coordinator.setMaxWorkers(5);
    expect(pool.setMaxWorkers).toHaveBeenCalledWith(5);
  });
});

// ────────────────────────────────────────────────────────────
// shutdown
// ────────────────────────────────────────────────────────────
describe("Coordinator shutdown", () => {
  it("WorkerPool.shutdown()을 호출하고 완료를 기다린다", async () => {
    const pool = makePoolMock();
    const coordinator = new Coordinator(makeConfig());
    await coordinator.shutdown(1000);
    expect(pool.shutdown).toHaveBeenCalledWith(1000);
  });

  it("기본 timeout 30000ms로 호출된다", async () => {
    const pool = makePoolMock();
    const coordinator = new Coordinator(makeConfig());
    await coordinator.shutdown();
    expect(pool.shutdown).toHaveBeenCalledWith(30000);
  });
});

// ────────────────────────────────────────────────────────────
// submitTask — WorkerPool.submit 위임 검증
// ────────────────────────────────────────────────────────────
describe("Coordinator submitTask", () => {
  it("WorkerPool.submit()에 위임하고 결과를 반환한다", async () => {
    const pool = makePoolMock();
    const fakeResult = { taskId: "task-1", workerId: "worker-1", output: "result", success: true, duration: 10 };
    pool.submit.mockResolvedValue(fakeResult);

    const coordinator = new Coordinator(makeConfig());
    const result = await coordinator.submitTask({ id: "task-1", prompt: "do something" });

    expect(result).toBe(fakeResult);
    expect(pool.submit).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────
// submitTasks — 병렬 실행
// ────────────────────────────────────────────────────────────
describe("Coordinator submitTasks", () => {
  it("모든 태스크의 결과를 반환한다", async () => {
    const pool = makePoolMock();
    pool.submit
      .mockResolvedValueOnce({ taskId: "t1", workerId: "worker-1", output: "a", success: true, duration: 1 })
      .mockResolvedValueOnce({ taskId: "t2", workerId: "worker-1", output: "b", success: true, duration: 1 })
      .mockResolvedValueOnce({ taskId: "t3", workerId: "worker-2", output: "c", success: true, duration: 1 });

    const coordinator = new Coordinator(makeConfig({ maxWorkers: 3 }));
    const results = await coordinator.submitTasks([
      { id: "t1", prompt: "a" },
      { id: "t2", prompt: "b" },
      { id: "t3", prompt: "c" },
    ]);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("submit 실패 시 error 결과를 반환한다", async () => {
    const pool = makePoolMock();
    pool.submit
      .mockResolvedValueOnce({ taskId: "ok", workerId: "worker-1", output: "ok", success: true, duration: 1 })
      .mockRejectedValueOnce(new Error("pool error"));

    const coordinator = new Coordinator(makeConfig());
    const results = await coordinator.submitTasks([
      { id: "ok", prompt: "ok" },
      { id: "fail", prompt: "fail" },
    ]);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain("pool error");
  });

  it("빈 배열 입력 시 빈 배열을 반환한다", async () => {
    makePoolMock();
    const coordinator = new Coordinator(makeConfig());
    const results = await coordinator.submitTasks([]);
    expect(results).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
// WorkerPool idle shrink — config 연동 통합 검증
// ────────────────────────────────────────────────────────────
describe("WorkerPool idle shrink config 연동", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("idleTimeoutMs 설정 시 idle 워커가 shrink된다", async () => {
    vi.useRealTimers();
    // WorkerPool mock을 해제하고 실제 WorkerPool로 테스트
    vi.mocked(WorkerPool).mockRestore();

    vi.useFakeTimers();
    const { runCli } = await import("../../src/utils/cli-runner.js");
    vi.mocked(runCli).mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    // 실제 WorkerPool 사용 (mock 해제됨)
    const { WorkerPool: RealWorkerPool } = await vi.importActual<typeof import("../../src/claude/worker-pool.js")>(
      "../../src/claude/worker-pool.js"
    );
    const handler = vi.fn().mockResolvedValue({ taskId: "t1", workerId: "w1", output: "ok", success: true, duration: 0 });
    const pool = new RealWorkerPool(2, handler, { idleTimeoutMs: 2000, minWorkers: 0 });

    // 태스크 실행 → 워커 생성 후 idle
    await pool.submit("input");
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getWorkers().length).toBe(1);
    expect(pool.getWorkers()[0].status).toBe("idle");

    // idleTimeoutMs 경과 후 shrink 확인
    await vi.advanceTimersByTimeAsync(2000);
    expect(pool.getWorkers().length).toBe(0);
  });

  it("minWorkers 설정 시 shrink 하한이 보장된다", async () => {
    vi.useRealTimers();
    vi.mocked(WorkerPool).mockRestore();

    vi.useFakeTimers();
    const { WorkerPool: RealWorkerPool } = await vi.importActual<typeof import("../../src/claude/worker-pool.js")>(
      "../../src/claude/worker-pool.js"
    );

    const resolvers: Array<() => void> = [];
    const handler = vi.fn().mockImplementation(
      () => new Promise<string>((res) => resolvers.push(() => res("done")))
    );

    const pool = new RealWorkerPool(3, handler, { idleTimeoutMs: 1000, minWorkers: 1 });

    // 두 태스크를 동시에 제출 → 각각 worker-1, worker-2 생성
    const pa = pool.submit("a");
    const pb = pool.submit("b");
    await vi.advanceTimersByTimeAsync(0);

    // 두 워커가 busy 상태로 존재
    expect(pool.getWorkers().length).toBe(2);

    // 두 태스크 완료 → 두 워커 모두 idle, idle timer 시작
    resolvers[0]();
    resolvers[1]();
    await pa;
    await pb;
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getWorkers().length).toBe(2);
    expect(pool.getWorkers().every((w) => w.status === "idle")).toBe(true);

    // 1000ms 경과 → shrink 실행, minWorkers=1 이므로 워커 1개만 남음
    await vi.advanceTimersByTimeAsync(1000);
    expect(pool.getWorkers().length).toBe(1);
  });
});
