import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeTask, ClaudeTaskOptions } from "../../src/tasks/claude-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import { runClaude, getActiveProcessPids } from "../../src/claude/claude-runner.js";

vi.mock("../../src/claude/claude-runner.js");
const mockRunClaude = vi.mocked(runClaude);
const mockGetActiveProcessPids = vi.mocked(getActiveProcessPids);

describe("ClaudeTask", () => {
  let testOptions: ClaudeTaskOptions;

  beforeEach(() => {
    vi.clearAllMocks();

    testOptions = {
      prompt: "Test prompt",
      config: {
        path: "claude",
        model: "sonnet",
        maxTurns: 10,
        timeout: 30000,
        additionalArgs: []
      }
    };

    mockGetActiveProcessPids.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("생성 및 기본 속성", () => {
    it("should create task with auto-generated ID", () => {
      const task = new ClaudeTask(testOptions);

      expect(task.id).toBeDefined();
      expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i); // UUID format
      expect(task.type).toBe("claude");
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should create task with custom ID", () => {
      const customOptions = { ...testOptions, id: "custom-task-id" };
      const task = new ClaudeTask(customOptions);

      expect(task.id).toBe("custom-task-id");
      expect(task.type).toBe("claude");
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should preserve all task options", () => {
      const fullOptions: ClaudeTaskOptions = {
        ...testOptions,
        id: "test-id",
        cwd: "/custom/path",
        systemPrompt: "System prompt",
        jsonSchema: "{}",
        maxTurns: 5,
        enableAgents: true,
        metadata: { key: "value" }
      };

      const task = new ClaudeTask(fullOptions);
      const json = task.toJSON();

      expect(json.metadata).toMatchObject({
        systemPrompt: "System prompt",
        maxTurns: 5,
        enableAgents: true,
        key: "value"
      });
    });
  });

  describe("태스크 실행", () => {
    it("should execute successfully", async () => {
      const mockResult = {
        success: true,
        output: "Success output",
        durationMs: 1500,
        costUsd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20
        }
      };

      mockRunClaude.mockResolvedValueOnce(mockResult);

      const task = new ClaudeTask(testOptions);
      const result = await task.run();

      expect(result).toBe(mockResult);
      expect(task.status).toBe(TaskStatus.SUCCESS);
      expect(task.getResult()).toBe(mockResult);

      // runClaude가 올바른 옵션으로 호출되었는지 확인
      expect(mockRunClaude).toHaveBeenCalledWith({
        prompt: testOptions.prompt,
        cwd: process.cwd(),
        config: testOptions.config,
        systemPrompt: undefined,
        jsonSchema: undefined,
        maxTurns: undefined,
        enableAgents: undefined,
        onStderr: expect.any(Function),
      });
    });

    it("should handle execution failure", async () => {
      const mockResult = {
        success: false,
        output: "Error output",
        durationMs: 800
      };

      mockRunClaude.mockResolvedValueOnce(mockResult);

      const task = new ClaudeTask(testOptions);
      const result = await task.run();

      expect(result).toBe(mockResult);
      expect(task.status).toBe(TaskStatus.FAILED);
      expect(task.getResult()).toBe(mockResult);
    });

    it("should handle thrown error during execution", async () => {
      const error = new Error("Claude execution failed");
      mockRunClaude.mockRejectedValueOnce(error);

      const task = new ClaudeTask(testOptions);

      await expect(task.run()).rejects.toThrow("Claude execution failed");
      expect(task.status).toBe(TaskStatus.FAILED);

      const result = task.getResult();
      expect(result?.success).toBe(false);
      expect(result?.output).toBe("Claude execution failed");
    });

    it("should prevent multiple runs on same task", async () => {
      mockRunClaude.mockResolvedValue({ success: true, output: "test", durationMs: 1000 });

      const task = new ClaudeTask(testOptions);

      await task.run();

      await expect(task.run()).rejects.toThrow(/already SUCCESS and cannot be run again/);
    });

    it("should track process ID during execution", async () => {
      const mockPid = 12345;
      mockGetActiveProcessPids.mockReturnValue([mockPid]);

      mockRunClaude.mockImplementation(async (options) => {
        // stderr 콜백 호출 시뮬레이션
        options.onStderr?.("Test stderr output");
        return { success: true, output: "test", durationMs: 1000 };
      });

      const task = new ClaudeTask(testOptions);
      await task.run();

      expect(mockGetActiveProcessPids).toHaveBeenCalled();
    });
  });

  describe("태스크 종료", () => {
    it("should kill running task", async () => {
      const mockPid = 12345;

      // process.kill을 모킹
      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

      const task = new ClaudeTask(testOptions);

      // 실행 중인 상태로 설정
      mockRunClaude.mockImplementation(async () => {
        // 실행 중 상태를 시뮬레이션하기 위해 무한 대기
        return new Promise(() => {});
      });

      // 별도 태스크로 실행 시작
      const runPromise = task.run();

      // 태스크를 실행 상태로 만들기 위해 잠깐 대기
      await new Promise(resolve => setTimeout(resolve, 10));

      // 프로세스 ID 설정 (private이므로 reflection 사용)
      (task as any)._processId = mockPid;
      (task as any)._status = TaskStatus.RUNNING;

      // 활성 프로세스 목록에 포함되도록 설정
      mockGetActiveProcessPids.mockReturnValue([mockPid]);

      await task.kill();

      expect(task.status).toBe(TaskStatus.KILLED);
      expect(mockKill).toHaveBeenCalledWith(mockPid, "SIGTERM");

      mockKill.mockRestore();
    });

    it("should handle kill on non-running task", async () => {
      const task = new ClaudeTask(testOptions);

      // PENDING 상태에서 kill 호출
      await task.kill();

      // 상태 변경되지 않아야 함
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("should handle process kill error gracefully", async () => {
      const mockPid = 12345;
      const mockKill = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("Process not found");
      });

      const task = new ClaudeTask(testOptions);

      // 실행 중 상태로 설정
      (task as any)._processId = mockPid;
      (task as any)._status = TaskStatus.RUNNING;

      // 에러가 발생해도 정상 종료되어야 함
      await expect(task.kill()).resolves.toBeUndefined();
      expect(task.status).toBe(TaskStatus.KILLED);

      mockKill.mockRestore();
    });
  });

  describe("상태 전이", () => {
    it("should track status changes during execution lifecycle", async () => {
      const task = new ClaudeTask(testOptions);

      // 초기 상태
      expect(task.status).toBe(TaskStatus.PENDING);

      // 실행 중 상태 확인을 위한 모킹
      mockRunClaude.mockImplementation(async () => {
        // 실행 중임을 확인할 수 있도록 잠깐 대기
        await new Promise(resolve => setTimeout(resolve, 10));
        return { success: true, output: "test", durationMs: 1000 };
      });

      const runPromise = task.run();

      // 실행 시작 후 잠깐 대기하여 RUNNING 상태 확인
      await new Promise(resolve => setTimeout(resolve, 5));

      const result = await runPromise;

      expect(result.success).toBe(true);
      expect(task.status).toBe(TaskStatus.SUCCESS);
    });

    it("should detect dead process and update status", () => {
      const task = new ClaudeTask(testOptions);
      const mockPid = 12345;

      // 실행 중 상태로 설정
      (task as any)._processId = mockPid;
      (task as any)._status = TaskStatus.RUNNING;

      // 프로세스가 죽었음을 시뮬레이션 (활성 목록에서 제외)
      mockGetActiveProcessPids.mockReturnValue([]);

      // status getter 호출 시 자동으로 FAILED로 전이되어야 함
      expect(task.status).toBe(TaskStatus.FAILED);
    });
  });

  describe("라이프사이클 이벤트", () => {
    it("should emit started event when run begins", async () => {
      mockRunClaude.mockResolvedValueOnce({ success: true, output: "ok", durationMs: 100 });

      const task = new ClaudeTask(testOptions);
      const startedFn = vi.fn();
      task.on("started", startedFn);

      await task.run();

      expect(startedFn).toHaveBeenCalledTimes(1);
    });

    it("should emit completed event on success", async () => {
      mockRunClaude.mockResolvedValueOnce({ success: true, output: "ok", durationMs: 100 });

      const task = new ClaudeTask(testOptions);
      const completedFn = vi.fn();
      const failedFn = vi.fn();
      task.on("completed", completedFn);
      task.on("failed", failedFn);

      await task.run();

      expect(completedFn).toHaveBeenCalledTimes(1);
      expect(failedFn).not.toHaveBeenCalled();
    });

    it("should emit failed event on unsuccessful result", async () => {
      mockRunClaude.mockResolvedValueOnce({ success: false, output: "err", durationMs: 100 });

      const task = new ClaudeTask(testOptions);
      const completedFn = vi.fn();
      const failedFn = vi.fn();
      task.on("completed", completedFn);
      task.on("failed", failedFn);

      await task.run();

      expect(failedFn).toHaveBeenCalledTimes(1);
      expect(completedFn).not.toHaveBeenCalled();
    });

    it("should emit failed event on thrown error", async () => {
      mockRunClaude.mockRejectedValueOnce(new Error("crash"));

      const task = new ClaudeTask(testOptions);
      const failedFn = vi.fn();
      task.on("failed", failedFn);

      await expect(task.run()).rejects.toThrow("crash");

      expect(failedFn).toHaveBeenCalledTimes(1);
    });

    it("should emit killed event when kill is called", async () => {
      const task = new ClaudeTask(testOptions);
      const killedFn = vi.fn();
      task.on("killed", killedFn);

      (task as any)._status = TaskStatus.RUNNING;
      await task.kill();

      expect(killedFn).toHaveBeenCalledTimes(1);
    });

    it("should support once listener (fires only once)", async () => {
      mockRunClaude
        .mockResolvedValueOnce({ success: true, output: "ok", durationMs: 100 });

      const task = new ClaudeTask(testOptions);
      const onceFn = vi.fn();
      task.once("started", onceFn);

      await task.run();

      expect(onceFn).toHaveBeenCalledTimes(1);
    });

    it("should support off (remove listener)", async () => {
      mockRunClaude.mockResolvedValueOnce({ success: true, output: "ok", durationMs: 100 });

      const task = new ClaudeTask(testOptions);
      const startedFn = vi.fn();
      task.on("started", startedFn);
      task.off("started", startedFn);

      await task.run();

      expect(startedFn).not.toHaveBeenCalled();
    });
  });

  describe("직렬화", () => {
    it("should serialize task to JSON summary", () => {
      const task = new ClaudeTask({
        ...testOptions,
        id: "test-id",
        metadata: { custom: "value" }
      });

      const json = task.toJSON();

      expect(json).toEqual({
        id: "test-id",
        type: "claude",
        status: TaskStatus.PENDING,
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
        metadata: {
          custom: "value",
          prompt: testOptions.prompt,
          systemPrompt: undefined,
          maxTurns: undefined,
          enableAgents: undefined,
          success: undefined,
          costUsd: undefined,
          usage: undefined,
        }
      });
    });

    it("should truncate long prompt in metadata", () => {
      const longPrompt = "a".repeat(150);
      const task = new ClaudeTask({
        ...testOptions,
        prompt: longPrompt
      });

      const json = task.toJSON();

      expect(json.metadata?.prompt).toBe("a".repeat(100) + "...");
    });

    it("should include execution result in metadata after run", async () => {
      const mockResult = {
        success: true,
        output: "Success",
        durationMs: 1500,
        costUsd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20
        }
      };

      mockRunClaude.mockResolvedValueOnce(mockResult);

      const task = new ClaudeTask(testOptions);
      await task.run();

      const json = task.toJSON();

      expect(json.metadata?.success).toBe(true);
      expect(json.metadata?.costUsd).toBe(0.05);
      expect(json.metadata?.usage).toEqual(mockResult.usage);
      // durationMs는 실제 실행 시간을 계산하므로 정확한 값은 예측할 수 없음
      // 대신 정의되어 있고 숫자인지만 확인
      expect(json.durationMs).toBeDefined();
      expect(typeof json.durationMs).toBe("number");
      expect(json.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});