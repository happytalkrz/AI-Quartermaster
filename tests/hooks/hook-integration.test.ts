import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookRegistry } from "../../src/hooks/hook-registry.js";
import { HookExecutor } from "../../src/hooks/hook-executor.js";
import type { HooksConfig } from "../../src/types/hooks.js";

// Mock child_process
vi.mock("child_process", async () => {
  const actual = await vi.importActual("child_process");
  return {
    ...actual,
    exec: vi.fn(),
  };
});

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock promisify
vi.mock("util", async () => {
  const actual = await vi.importActual("util");
  return {
    ...actual,
    promisify: vi.fn((fn) => {
      return vi.fn().mockImplementation(async (...args) => {
        return new Promise((resolve, reject) => {
          fn(...args, (err: unknown, stdout: string, stderr: string) => {
            if (err) {
              const error = Object.assign(err as object, { stdout, stderr });
              reject(error);
            } else {
              resolve({ stdout, stderr });
            }
          });
        });
      });
    }),
  };
});

describe("Hook Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("훅 등록 및 실행 흐름", () => {
    it("HookRegistry에서 훅을 조회하여 HookExecutor로 실행할 수 있다", async () => {
      const config: HooksConfig = {
        "pre-plan": [{ command: "echo pre-plan", timeout: 5000 }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) callback(null, "pre-plan output", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-plan");
      const results = await executor.executeHooks(hooks);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].stdout).toBe("pre-plan output");
    });

    it("여러 타이밍의 훅을 순서대로 실행할 수 있다", async () => {
      const config: HooksConfig = {
        "pre-plan": [{ command: "echo pre-plan" }],
        "post-plan": [{ command: "echo post-plan" }],
        "pre-pr": [{ command: "echo pre-pr" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const executedCommands: string[] = [];

      mockExec.mockImplementation((command, options, callback) => {
        executedCommands.push(command as string);
        if (callback) callback(null, `output: ${command}`, "");
        return {} as ReturnType<typeof exec>;
      });

      const timings = ["pre-plan", "post-plan", "pre-pr"] as const;
      for (const timing of timings) {
        const hooks = registry.getHooks(timing);
        await executor.executeHooks(hooks);
      }

      expect(executedCommands).toEqual(["echo pre-plan", "echo post-plan", "echo pre-pr"]);
    });

    it("훅이 없는 타이밍은 빈 배열을 반환한다", async () => {
      const config: HooksConfig = {
        "pre-plan": [{ command: "echo pre-plan" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const hooks = registry.getHooks("post-pr");
      const results = await executor.executeHooks(hooks);

      expect(results).toEqual([]);
    });

    it("한 타이밍에 여러 훅이 등록되면 모두 순서대로 실행된다", async () => {
      const config: HooksConfig = {
        "pre-phase": [
          { command: "echo first" },
          { command: "echo second" },
          { command: "echo third" },
        ],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let callOrder = 0;

      mockExec.mockImplementation((command, options, callback) => {
        callOrder++;
        if (callback) callback(null, `call ${callOrder}`, "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-phase");
      const results = await executor.executeHooks(hooks);

      expect(results).toHaveLength(3);
      expect(results[0].stdout).toBe("call 1");
      expect(results[1].stdout).toBe("call 2");
      expect(results[2].stdout).toBe("call 3");
      expect(mockExec).toHaveBeenCalledTimes(3);
    });
  });

  describe("훅 실패 시 파이프라인 계속 진행", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("중간 훅이 실패해도 나머지 훅이 계속 실행된다", async () => {
      const config: HooksConfig = {
        "post-phase": [
          { command: "echo first" },
          { command: "failing-command" },
          { command: "echo third" },
        ],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let callCount = 0;

      mockExec.mockImplementation((command, options, callback) => {
        callCount++;
        if (callback) {
          if (callCount === 2) {
            const error = Object.assign(new Error("Command failed"), {
              code: 1,
              stdout: "",
              stderr: "command not found",
            });
            callback(error as NodeJS.ErrnoException, "", "command not found");
          } else {
            callback(null, `output ${callCount}`, "");
          }
        }
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("post-phase");
      const results = await executor.executeHooks(hooks);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
      expect(mockExec).toHaveBeenCalledTimes(3);
    });

    it("첫 번째 훅이 실패해도 이후 훅이 실행된다", async () => {
      const config: HooksConfig = {
        "pre-review": [
          { command: "failing-first" },
          { command: "echo second" },
        ],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let callCount = 0;

      mockExec.mockImplementation((command, options, callback) => {
        callCount++;
        if (callback) {
          if (callCount === 1) {
            const error = Object.assign(new Error("Script failed"), {
              code: 127,
              stdout: "",
              stderr: "command not found",
            });
            callback(error as NodeJS.ErrnoException, "", "command not found");
          } else {
            callback(null, "second output", "");
          }
        }
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-review");
      const results = await executor.executeHooks(hooks);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Script failed");
      expect(results[1].success).toBe(true);
      expect(results[1].stdout).toBe("second output");
    });

    it("모든 훅이 실패해도 결과 배열이 반환된다", async () => {
      const config: HooksConfig = {
        "post-review": [
          { command: "bad-cmd-1" },
          { command: "bad-cmd-2" },
        ],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          const error = Object.assign(new Error("All failed"), {
            code: 1,
            stdout: "",
            stderr: "error",
          });
          callback(error as NodeJS.ErrnoException, "", "error");
        }
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("post-review");
      const results = await executor.executeHooks(hooks);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(false);
    });

    it("실패한 훅의 결과에 exitCode와 stderr가 포함된다", async () => {
      const config: HooksConfig = {
        "pre-pr": [{ command: "failing-hook", timeout: 5000 }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          const error = Object.assign(new Error("Non-zero exit"), {
            code: 2,
            stdout: "",
            stderr: "permission denied",
          });
          callback(error as NodeJS.ErrnoException, "", "permission denied");
        }
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-pr");
      const results = await executor.executeHooks(hooks);

      expect(results[0].success).toBe(false);
      expect(results[0].exitCode).toBe(2);
      expect(results[0].stderr).toBe("permission denied");
      expect(results[0].error).toBe("Non-zero exit");
    });
  });

  describe("컨텍스트 변수 치환", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("훅 커맨드에 변수가 올바르게 치환된다", async () => {
      const config: HooksConfig = {
        "pre-plan": [{ command: "echo {{repo}} {{issue_number}}" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({
        repo: "owner/project",
        issue_number: "42",
      });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let capturedCommand = "";

      mockExec.mockImplementation((command, options, callback) => {
        capturedCommand = command as string;
        if (callback) callback(null, "output", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-plan");
      await executor.executeHooks(hooks);

      expect(capturedCommand).toBe('echo "$HOOK_REPO" "$HOOK_ISSUE_NUMBER"');
    });

    it("updateVariables로 추가된 변수도 치환된다", async () => {
      const config: HooksConfig = {
        "post-plan": [{ command: "notify.sh {{mode}} {{phase_count}}" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({ mode: "standard" });

      executor.updateVariables({ phase_count: "5" });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let capturedCommand = "";

      mockExec.mockImplementation((command, options, callback) => {
        capturedCommand = command as string;
        if (callback) callback(null, "ok", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("post-plan");
      await executor.executeHooks(hooks);

      expect(capturedCommand).toBe('notify.sh "$HOOK_MODE" "$HOOK_PHASE_COUNT"');
    });

    it("존재하지 않는 변수는 그대로 유지된다", async () => {
      const config: HooksConfig = {
        "pre-phase": [{ command: "run {{missing_var}} {{repo}}" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({ repo: "owner/repo" });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let capturedCommand = "";

      mockExec.mockImplementation((command, options, callback) => {
        capturedCommand = command as string;
        if (callback) callback(null, "ok", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-phase");
      await executor.executeHooks(hooks);

      expect(capturedCommand).toBe('run {{missing_var}} "$HOOK_REPO"');
    });

    it("같은 변수가 여러 번 등장하면 모두 치환된다", async () => {
      const config: HooksConfig = {
        "post-phase": [{ command: "echo {{repo}} && log {{repo}}" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({ repo: "owner/my-repo" });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let capturedCommand = "";

      mockExec.mockImplementation((command, options, callback) => {
        capturedCommand = command as string;
        if (callback) callback(null, "ok", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("post-phase");
      await executor.executeHooks(hooks);

      expect(capturedCommand).toBe('echo "$HOOK_REPO" && log "$HOOK_REPO"');
    });

    it("여러 훅 각각에 변수가 독립적으로 치환된다", async () => {
      const config: HooksConfig = {
        "post-pr": [
          { command: "curl {{pr_url}}" },
          { command: "notify {{pr_url}} {{issue_number}}" },
        ],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({
        pr_url: "https://github.com/owner/repo/pull/99",
        issue_number: "42",
      });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const capturedCommands: string[] = [];

      mockExec.mockImplementation((command, options, callback) => {
        capturedCommands.push(command as string);
        if (callback) callback(null, "ok", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("post-pr");
      await executor.executeHooks(hooks);

      expect(capturedCommands[0]).toBe('curl "$HOOK_PR_URL"');
      expect(capturedCommands[1]).toBe('notify "$HOOK_PR_URL" "$HOOK_ISSUE_NUMBER"');
    });
  });

  describe("HookRegistry + HookExecutor 결합 검증", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("hasHooks가 false인 타이밍은 실행을 건너뛴다", async () => {
      const config: HooksConfig = {
        "pre-plan": [{ command: "echo pre-plan" }],
      };
      const registry = new HookRegistry(config);
      const executor = new HookExecutor({});

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      // post-plan에는 훅이 없으므로 실행하지 않아야 함
      expect(registry.hasHooks("post-plan")).toBe(false);

      if (registry.hasHooks("post-plan")) {
        const hooks = registry.getHooks("post-plan");
        await executor.executeHooks(hooks);
      }

      expect(mockExec).not.toHaveBeenCalled();
    });

    it("updateConfig로 훅을 교체하면 새 훅이 실행된다", async () => {
      const initialConfig: HooksConfig = {
        "pre-plan": [{ command: "echo old-hook" }],
      };
      const registry = new HookRegistry(initialConfig);
      const executor = new HookExecutor({});

      registry.updateConfig({
        "pre-plan": [{ command: "echo new-hook" }],
      });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);
      let capturedCommand = "";

      mockExec.mockImplementation((command, options, callback) => {
        capturedCommand = command as string;
        if (callback) callback(null, "ok", "");
        return {} as ReturnType<typeof exec>;
      });

      const hooks = registry.getHooks("pre-plan");
      await executor.executeHooks(hooks);

      expect(capturedCommand).toBe("echo new-hook");
    });

    it("getHookCount가 0이면 실행할 훅이 없다", async () => {
      const emptyRegistry = new HookRegistry({});
      expect(emptyRegistry.getHookCount()).toBe(0);
      expect(emptyRegistry.getAllTimings()).toEqual([]);
    });
  });
});
