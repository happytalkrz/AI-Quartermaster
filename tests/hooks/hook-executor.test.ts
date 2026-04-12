import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookExecutor } from "../../src/hooks/hook-executor.js";
import type { HookDefinition } from "../../src/types/hooks.js";

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
          fn(...args, (err: any, stdout: string, stderr: string) => {
            if (err) {
              const error = Object.assign(err, { stdout, stderr });
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

describe("HookExecutor", () => {
  let executor: HookExecutor;
  let mockVariables: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVariables = {
      projectName: "test-project",
      phase: "implementation",
      issueNumber: "123",
      branchName: "feat/test-feature",
      "nested.path": "src/components"
    };
    executor = new HookExecutor(mockVariables);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("constructor", () => {
    it("should initialize with provided variables", () => {
      expect(executor).toBeDefined();
    });

    it("should initialize with empty variables", () => {
      const emptyExecutor = new HookExecutor({});
      expect(emptyExecutor).toBeDefined();
    });
  });

  describe("executeHook", () => {
    it("should execute command successfully", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      // Mock successful execution
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "command executed successfully", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo 'hello world'",
        timeout: 5000
      };

      const result = await executor.executeHook(hook);

      expect(result).toEqual({
        success: true,
        stdout: "command executed successfully",
        stderr: "",
        exitCode: 0,
        duration: expect.any(Number)
      });

      expect(mockExec).toHaveBeenCalledWith(
        "echo 'hello world'",
        expect.objectContaining({
          timeout: 5000,
          encoding: "utf8"
        }),
        expect.any(Function)
      );
    });

    it("should handle command failure", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      // Mock failed execution
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          const error = new Error("Command failed") as any;
          error.code = 1;
          error.stdout = "";
          error.stderr = "command not found";
          callback(error, "", "command not found");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "invalid-command",
        timeout: 5000
      };

      const result = await executor.executeHook(hook);

      expect(result).toEqual({
        success: false,
        stdout: "",
        stderr: "command not found",
        exitCode: 1,
        duration: expect.any(Number),
        error: "Command failed"
      });
    });

    it("should handle timeout", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      // Mock timeout
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          const error = new Error("Command timed out") as any;
          error.code = "TIMEOUT";
          error.signal = "SIGKILL";
          callback(error, "", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "sleep 10",
        timeout: 1000
      };

      const result = await executor.executeHook(hook);

      expect(result).toEqual({
        success: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        duration: expect.any(Number),
        error: "Command timed out"
      });

      expect(mockExec).toHaveBeenCalledWith(
        "sleep 10",
        expect.objectContaining({
          timeout: 1000
        }),
        expect.any(Function)
      );
    });

    it("should use default timeout when not specified", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo test"
      };

      await executor.executeHook(hook);

      expect(mockExec).toHaveBeenCalledWith(
        "echo test",
        expect.objectContaining({
          timeout: 30000 // Default timeout
        }),
        expect.any(Function)
      );
    });
  });

  describe("variable substitution", () => {
    it("should substitute single variables via env-var injection", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo {{projectName}} {{issueNumber}}"
      };

      await executor.executeHook(hook);

      // 변수 값은 환경변수로 전달되고 명령에는 참조만 삽입됨
      expect(mockExec).toHaveBeenCalledWith(
        'echo "$HOOK_PROJECTNAME" "$HOOK_ISSUENUMBER"',
        expect.objectContaining({
          env: expect.objectContaining({
            HOOK_PROJECTNAME: "test-project",
            HOOK_ISSUENUMBER: "123",
          }),
        }),
        expect.any(Function)
      );
    });

    it("should substitute nested path variables via env-var injection", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "ls -la {{nested.path}}/{{projectName}}"
      };

      await executor.executeHook(hook);

      expect(mockExec).toHaveBeenCalledWith(
        'ls -la "$HOOK_NESTED_PATH"/"$HOOK_PROJECTNAME"',
        expect.objectContaining({
          env: expect.objectContaining({
            HOOK_NESTED_PATH: "src/components",
            HOOK_PROJECTNAME: "test-project",
          }),
        }),
        expect.any(Function)
      );
    });

    it("should handle missing variables — unknown placeholders unchanged", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo {{missingVariable}} {{projectName}}"
      };

      await executor.executeHook(hook);

      // 미등록 변수는 그대로 유지; 등록된 변수만 env-var 참조로 대체
      expect(mockExec).toHaveBeenCalledWith(
        'echo {{missingVariable}} "$HOOK_PROJECTNAME"',
        expect.objectContaining({
          env: expect.objectContaining({ HOOK_PROJECTNAME: "test-project" }),
        }),
        expect.any(Function)
      );
    });

    it("should handle multiple occurrences of same variable", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo {{projectName}} and {{projectName}} again"
      };

      await executor.executeHook(hook);

      expect(mockExec).toHaveBeenCalledWith(
        'echo "$HOOK_PROJECTNAME" and "$HOOK_PROJECTNAME" again',
        expect.objectContaining({
          env: expect.objectContaining({ HOOK_PROJECTNAME: "test-project" }),
        }),
        expect.any(Function)
      );
    });

    it("should handle empty variable values", async () => {
      const emptyVariables = { emptyVar: "", normalVar: "value" };
      const executorWithEmpty = new HookExecutor(emptyVariables);

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo {{emptyVar}} {{normalVar}}"
      };

      await executorWithEmpty.executeHook(hook);

      expect(mockExec).toHaveBeenCalledWith(
        'echo "$HOOK_EMPTYVAR" "$HOOK_NORMALVAR"',
        expect.objectContaining({
          env: expect.objectContaining({
            HOOK_EMPTYVAR: "",
            HOOK_NORMALVAR: "value",
          }),
        }),
        expect.any(Function)
      );
    });

    it("should prevent shell injection via malicious variable values", async () => {
      const maliciousExecutor = new HookExecutor({
        title: "'; rm -rf /tmp/pwned; echo '",
      });

      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) callback(null, "success", "");
        return {} as any;
      });

      const hook: HookDefinition = { command: "notify.sh {{title}}" };
      await maliciousExecutor.executeHook(hook);

      // 악성 값이 명령 문자열에 직접 포함되지 않고 환경변수로만 전달됨
      expect(mockExec).toHaveBeenCalledWith(
        'notify.sh "$HOOK_TITLE"',
        expect.objectContaining({
          env: expect.objectContaining({
            HOOK_TITLE: "'; rm -rf /tmp/pwned; echo '",
          }),
        }),
        expect.any(Function)
      );
      // 명령 문자열에 rm -rf가 포함되지 않았음을 명시적으로 확인
      const calledCommand = mockExec.mock.calls[0][0] as string;
      expect(calledCommand).not.toContain("rm -rf");
    });
  });

  describe("updateVariables", () => {
    it("should update variables", async () => {
      const newVariables = {
        newVar: "newValue",
        projectName: "updated-project"
      };

      executor.updateVariables(newVariables);

      // Test by executing a hook with the updated variables
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, "success", "");
        }
        return {} as any;
      });

      const hook: HookDefinition = {
        command: "echo {{newVar}} {{projectName}}"
      };

      return executor.executeHook(hook).then(() => {
        expect(mockExec).toHaveBeenCalledWith(
          'echo "$HOOK_NEWVAR" "$HOOK_PROJECTNAME"',
          expect.objectContaining({
            env: expect.objectContaining({
              HOOK_NEWVAR: "newValue",
              HOOK_PROJECTNAME: "updated-project",
            }),
          }),
          expect.any(Function)
        );
      });
    });
  });

  describe("executeHooks", () => {
    it("should execute multiple hooks in sequence", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      let executionCount = 0;
      mockExec.mockImplementation((command, options, callback) => {
        executionCount++;
        if (callback) {
          callback(null, `output ${executionCount}`, "");
        }
        return {} as any;
      });

      const hooks: HookDefinition[] = [
        { command: "echo first" },
        { command: "echo second" },
        { command: "echo third" }
      ];

      const results = await executor.executeHooks(hooks);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(true);
      expect(results[0].stdout).toBe("output 1");
      expect(results[1].stdout).toBe("output 2");
      expect(results[2].stdout).toBe("output 3");

      expect(mockExec).toHaveBeenCalledTimes(3);
    });

    it("should continue execution even if one hook fails", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      let executionCount = 0;
      mockExec.mockImplementation((command, options, callback) => {
        executionCount++;
        if (callback) {
          if (executionCount === 2) {
            // Second hook fails
            const error = new Error("Command failed") as any;
            error.code = 1;
            callback(error, "", "error");
          } else {
            callback(null, `output ${executionCount}`, "");
          }
        }
        return {} as any;
      });

      const hooks: HookDefinition[] = [
        { command: "echo first" },
        { command: "invalid-command" },
        { command: "echo third" }
      ];

      const results = await executor.executeHooks(hooks);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);

      expect(mockExec).toHaveBeenCalledTimes(3);
    });

    it("should handle empty hooks array", async () => {
      const results = await executor.executeHooks([]);
      expect(results).toEqual([]);
    });
  });
});