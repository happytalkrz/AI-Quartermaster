import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { ValidationTask, ValidationTaskOptions, ValidationTaskType } from "../../src/tasks/validation-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";

// child_process spawn 모킹
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

/**
 * 가짜 ChildProcess를 생성하는 헬퍼
 * stdout/stderr/process 이벤트를 직접 제어할 수 있다
 */
function createMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function makeOptions(
  validationType: ValidationTaskType,
  overrides: Partial<ValidationTaskOptions> = {}
): ValidationTaskOptions {
  return {
    validationType,
    command: "npx",
    args: validationType === "typecheck"
      ? ["tsc", "--noEmit"]
      : validationType === "test"
      ? ["vitest", "run"]
      : ["eslint", "src/"],
    cwd: "/fake/cwd",
    ...overrides,
  };
}

describe("ValidationTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 생성 및 기본 속성
  // ---------------------------------------------------------------------------
  describe("생성 및 기본 속성", () => {
    it("should auto-generate UUID when id is not provided", () => {
      const task = new ValidationTask(makeOptions("typecheck"));

      expect(task.id).toBeDefined();
      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should use provided id", () => {
      const task = new ValidationTask(makeOptions("typecheck", { id: "my-task" }));
      expect(task.id).toBe("my-task");
    });

    it("should have type = 'validation'", () => {
      const task = new ValidationTask(makeOptions("lint"));
      expect(task.type).toBe("validation");
    });

    it("should start with PENDING status", () => {
      const task = new ValidationTask(makeOptions("test"));
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should return undefined result before run", () => {
      const task = new ValidationTask(makeOptions("typecheck"));
      expect(task.getResult()).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // typecheck 성공 케이스
  // ---------------------------------------------------------------------------
  describe("typecheck 성공 케이스", () => {
    it("should return SUCCESS status and parsed TscParseResult on exit 0", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();

      // stdout 없이 종료
      child.emit("close", 0);

      const result = await runPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(result.parsed).toMatchObject({ totalErrors: 0, hasErrors: false });
    });

    it("should collect stdout and stderr before close", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();

      child.stdout.emit("data", Buffer.from("some output"));
      child.stderr.emit("data", Buffer.from("some stderr"));
      child.emit("close", 0);

      const result = await runPromise;

      expect(result.stdout).toBe("some output");
      expect(result.stderr).toBe("some stderr");
    });
  });

  // ---------------------------------------------------------------------------
  // typecheck 실패 케이스
  // ---------------------------------------------------------------------------
  describe("typecheck 실패 케이스", () => {
    it("should return FAILED status and parsed errors on non-zero exit", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const tscOutput =
        "src/foo.ts(10,5): error TS2345: Argument of type 'string' is not assignable to type 'number'.\n";

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();

      child.stdout.emit("data", Buffer.from(tscOutput));
      child.emit("close", 1);

      const result = await runPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(task.status).toBe(TaskStatus.FAILED);

      const parsed = result.parsed as { hasErrors: boolean; totalErrors: number; errorsByFile: Record<string, string[]> };
      expect(parsed.hasErrors).toBe(true);
      expect(parsed.totalErrors).toBe(1);
      expect(parsed.errorsByFile["src/foo.ts"]).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // test 성공/실패 케이스
  // ---------------------------------------------------------------------------
  describe("test 성공/실패 케이스", () => {
    it("should parse vitest PASS output on exit 0", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const vitestOutput = " PASS  tests/foo.test.ts\n";

      const task = new ValidationTask(makeOptions("test"));
      const runPromise = task.run();

      child.stdout.emit("data", Buffer.from(vitestOutput));
      child.emit("close", 0);

      const result = await runPromise;

      expect(result.success).toBe(true);
      expect(task.status).toBe(TaskStatus.SUCCESS);

      const parsed = result.parsed as { hasFailures: boolean; passedFiles: string[]; failedFiles: string[] };
      expect(parsed.hasFailures).toBe(false);
      expect(parsed.passedFiles).toContain("tests/foo.test.ts");
    });

    it("should parse vitest FAIL output on non-zero exit", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const vitestOutput = " FAIL  tests/bar.test.ts\n     × should work\n";

      const task = new ValidationTask(makeOptions("test"));
      const runPromise = task.run();

      child.stdout.emit("data", Buffer.from(vitestOutput));
      child.emit("close", 1);

      const result = await runPromise;

      expect(result.success).toBe(false);
      expect(task.status).toBe(TaskStatus.FAILED);

      const parsed = result.parsed as { hasFailures: boolean; failedFiles: string[]; failedTests: string[] };
      expect(parsed.hasFailures).toBe(true);
      expect(parsed.failedFiles).toContain("tests/bar.test.ts");
      expect(parsed.failedTests).toContain("should work");
    });
  });

  // ---------------------------------------------------------------------------
  // lint 성공/실패 케이스
  // ---------------------------------------------------------------------------
  describe("lint 성공/실패 케이스", () => {
    it("should parse eslint output on exit 0", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("lint"));
      const runPromise = task.run();

      child.emit("close", 0);

      const result = await runPromise;

      expect(result.success).toBe(true);
      expect(task.status).toBe(TaskStatus.SUCCESS);

      const parsed = result.parsed as { hasErrors: boolean; totalErrors: number };
      expect(parsed.hasErrors).toBe(false);
      expect(parsed.totalErrors).toBe(0);
    });

    it("should parse eslint errors on non-zero exit", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const eslintOutput =
        "src/foo.ts\n  10:5  error  no-unused-vars  no-unused-vars\n\n";

      const task = new ValidationTask(makeOptions("lint"));
      const runPromise = task.run();

      child.stdout.emit("data", Buffer.from(eslintOutput));
      child.emit("close", 1);

      const result = await runPromise;

      expect(result.success).toBe(false);
      expect(task.status).toBe(TaskStatus.FAILED);

      const parsed = result.parsed as { hasErrors: boolean; totalErrors: number; errorsByFile: Record<string, string[]> };
      expect(parsed.hasErrors).toBe(true);
      expect(parsed.totalErrors).toBe(1);
      expect(parsed.errorsByFile["src/foo.ts"]).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 중복 실행 방지
  // ---------------------------------------------------------------------------
  describe("중복 실행 방지", () => {
    it("should throw when run() is called on already-running task", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));

      // 첫 번째 run은 닫히지 않은 채로 대기
      const runPromise = task.run();

      // 즉시 두 번째 run 시도
      await expect(task.run()).rejects.toThrow(/already RUNNING/);

      // 정리
      child.emit("close", 0);
      await runPromise;
    });

    it("should throw when run() is called on completed task", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();
      child.emit("close", 0);
      await runPromise;

      await expect(task.run()).rejects.toThrow(/already SUCCESS/);
    });
  });

  // ---------------------------------------------------------------------------
  // 프로세스 오류 이벤트
  // ---------------------------------------------------------------------------
  describe("프로세스 오류 이벤트", () => {
    it("should reject run() and set FAILED status on spawn error event", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();

      child.emit("error", new Error("ENOENT: command not found"));

      await expect(runPromise).rejects.toThrow("ENOENT: command not found");
      expect(task.status).toBe(TaskStatus.FAILED);
    });

    it("should store error info in result on spawn error", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();

      child.emit("error", new Error("spawn failed"));

      await expect(runPromise).rejects.toThrow();
      expect(task.getResult()).toMatchObject({
        success: false,
        exitCode: 1,
        stderr: "spawn failed",
      });
    });
  });

  // ---------------------------------------------------------------------------
  // durationMs
  // ---------------------------------------------------------------------------
  describe("실행 시간 측정", () => {
    it("should report non-negative durationMs", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();
      child.emit("close", 0);

      const result = await runPromise;

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // kill()
  // ---------------------------------------------------------------------------
  describe("kill()", () => {
    it("should set status to KILLED when task is running", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();

      // 실행 중인 상태에서 kill
      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);

      // runPromise가 resolve될 수 있도록 close 이벤트 발생
      child.emit("close", 0);
      // kill 후에는 resolve되지 않을 수도 있으므로 race
      await Promise.race([runPromise, Promise.resolve()]);
    });

    it("should be no-op when task is PENDING", async () => {
      const task = new ValidationTask(makeOptions("typecheck"));

      await task.kill();

      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should be no-op when task is already SUCCESS", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      const runPromise = task.run();
      child.emit("close", 0);
      await runPromise;

      await task.kill();

      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("should call kill on child process", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck"));
      task.run(); // 대기하지 않음 — 비동기 실행 중

      // 잠깐 대기하여 spawn이 호출된 상태가 되도록
      await new Promise((r) => setTimeout(r, 0));

      await task.kill();

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });

  // ---------------------------------------------------------------------------
  // toJSON()
  // ---------------------------------------------------------------------------
  describe("toJSON()", () => {
    it("should include id, type, status in JSON", () => {
      const task = new ValidationTask(makeOptions("typecheck", { id: "t-001" }));
      const json = task.toJSON();

      expect(json.id).toBe("t-001");
      expect(json.type).toBe("validation");
      expect(json.status).toBe(TaskStatus.PENDING);
    });

    it("should include validationType and command in metadata", () => {
      const task = new ValidationTask(makeOptions("lint", { id: "t-002" }));
      const json = task.toJSON();

      expect(json.metadata?.validationType).toBe("lint");
      expect(json.metadata?.command).toBe("npx");
      expect(json.metadata?.args).toEqual(["eslint", "src/"]);
    });

    it("should include execution result in metadata after run", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck", { id: "t-003" }));
      const runPromise = task.run();
      child.emit("close", 0);
      await runPromise;

      const json = task.toJSON();

      expect(json.metadata?.success).toBe(true);
      expect(json.metadata?.exitCode).toBe(0);
      expect(json.durationMs).toBeGreaterThanOrEqual(0);
      expect(json.startedAt).toBeDefined();
      expect(json.completedAt).toBeDefined();
    });

    it("should include custom metadata", () => {
      const task = new ValidationTask(
        makeOptions("test", { id: "t-004", metadata: { issueId: 42 } })
      );
      const json = task.toJSON();

      expect(json.metadata?.issueId).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // spawn 호출 검증
  // ---------------------------------------------------------------------------
  describe("spawn 호출 검증", () => {
    it("should call spawn with correct command and args", async () => {
      const child = createMockChild();
      mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

      const task = new ValidationTask(makeOptions("typecheck", { cwd: "/my/project" }));
      const runPromise = task.run();
      child.emit("close", 0);
      await runPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "npx",
        ["tsc", "--noEmit"],
        expect.objectContaining({ cwd: "/my/project" })
      );
    });
  });
});
