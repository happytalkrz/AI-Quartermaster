import { describe, it, expect, vi } from "vitest";
import { createTask, type TaskCreationParams } from "../../src/tasks/task-factory.js";
import { ClaudeTask } from "../../src/tasks/claude-task.js";
import { ValidationTask } from "../../src/tasks/validation-task.js";
import { GitTask } from "../../src/tasks/git-task.js";
import { TaskStatus } from "../../src/tasks/aqm-task.js";
import type { ClaudeCliConfig } from "../../src/types/config.js";

const mockClaudeConfig: ClaudeCliConfig = {
  command: "claude",
  args: [],
  timeout: 60000,
  maxTurns: 10,
};

describe("createTask 팩토리", () => {
  describe("claude 타입", () => {
    it("ClaudeTask 인스턴스를 반환한다", () => {
      const params: TaskCreationParams = {
        type: "claude",
        options: {
          prompt: "test prompt",
          config: mockClaudeConfig,
        },
      };

      const task = createTask(params);

      expect(task).toBeInstanceOf(ClaudeTask);
    });

    it("생성된 ClaudeTask의 type이 'claude'이다", () => {
      const params: TaskCreationParams = {
        type: "claude",
        options: {
          prompt: "hello",
          config: mockClaudeConfig,
        },
      };

      const task = createTask(params);

      expect(task.type).toBe("claude");
    });

    it("초기 상태가 PENDING이다", () => {
      const params: TaskCreationParams = {
        type: "claude",
        options: {
          prompt: "hello",
          config: mockClaudeConfig,
        },
      };

      const task = createTask(params);

      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it("options.id가 지정되면 해당 id를 사용한다", () => {
      const params: TaskCreationParams = {
        type: "claude",
        options: {
          id: "custom-claude-id",
          prompt: "hello",
          config: mockClaudeConfig,
        },
      };

      const task = createTask(params);

      expect(task.id).toBe("custom-claude-id");
    });
  });

  describe("validation 타입", () => {
    it("ValidationTask 인스턴스를 반환한다", () => {
      const params: TaskCreationParams = {
        type: "validation",
        options: {
          validationType: "typecheck",
          command: "npx",
          args: ["tsc", "--noEmit"],
        },
      };

      const task = createTask(params);

      expect(task).toBeInstanceOf(ValidationTask);
    });

    it("생성된 ValidationTask의 type이 'validation'이다", () => {
      const params: TaskCreationParams = {
        type: "validation",
        options: {
          validationType: "lint",
          command: "npx",
          args: ["eslint", "src/"],
        },
      };

      const task = createTask(params);

      expect(task.type).toBe("validation");
    });

    it("test 타입의 ValidationTask를 생성할 수 있다", () => {
      const params: TaskCreationParams = {
        type: "validation",
        options: {
          validationType: "test",
          command: "npx",
          args: ["vitest", "run"],
        },
      };

      const task = createTask(params);

      expect(task).toBeInstanceOf(ValidationTask);
      expect(task.type).toBe("validation");
      expect(task.status).toBe(TaskStatus.PENDING);
    });
  });

  describe("git 타입", () => {
    it("GitTask 인스턴스를 반환한다", () => {
      const params: TaskCreationParams = {
        type: "git",
        options: {
          params: {
            operation: "syncBaseBranch",
            gitConfig: {
              defaultBranch: "main",
              remote: "origin",
              worktreeBase: ".aq-worktrees",
              branchPrefix: "aq/",
              commitMsgTemplate: "[#{issue}] {title}",
            },
          },
        },
      };

      const task = createTask(params);

      expect(task).toBeInstanceOf(GitTask);
    });

    it("생성된 GitTask의 type이 'git'이다", () => {
      const params: TaskCreationParams = {
        type: "git",
        options: {
          params: {
            operation: "pushBranch",
            gitConfig: {
              defaultBranch: "main",
              remote: "origin",
              worktreeBase: ".aq-worktrees",
              branchPrefix: "aq/",
              commitMsgTemplate: "[#{issue}] {title}",
            },
            branchName: "aq/123-test",
          },
        },
      };

      const task = createTask(params);

      expect(task.type).toBe("git");
    });

    it("초기 상태가 PENDING이다", () => {
      const params: TaskCreationParams = {
        type: "git",
        options: {
          params: {
            operation: "autoCommit",
            gitPath: "/repo/.git",
            commitMsg: "test commit",
          },
        },
      };

      const task = createTask(params);

      expect(task.status).toBe(TaskStatus.PENDING);
    });
  });

  describe("공통 AQMTask 계약", () => {
    it("모든 태스크 타입이 toJSON()을 구현한다", () => {
      const claudeTask = createTask({
        type: "claude",
        options: { prompt: "test", config: mockClaudeConfig },
      });
      const validationTask = createTask({
        type: "validation",
        options: { validationType: "typecheck", command: "npx", args: ["tsc"] },
      });
      const gitTask = createTask({
        type: "git",
        options: {
          params: {
            operation: "syncBaseBranch",
            gitConfig: {
              defaultBranch: "main",
              remote: "origin",
              worktreeBase: ".aq-worktrees",
              branchPrefix: "aq/",
              commitMsgTemplate: "[#{issue}] {title}",
            },
          },
        },
      });

      expect(typeof claudeTask.toJSON).toBe("function");
      expect(typeof validationTask.toJSON).toBe("function");
      expect(typeof gitTask.toJSON).toBe("function");

      expect(claudeTask.toJSON().type).toBe("claude");
      expect(validationTask.toJSON().type).toBe("validation");
      expect(gitTask.toJSON().type).toBe("git");
    });

    it("모든 태스크 타입이 kill()을 구현한다", () => {
      const tasks = [
        createTask({ type: "claude", options: { prompt: "test", config: mockClaudeConfig } }),
        createTask({ type: "validation", options: { validationType: "typecheck", command: "npx", args: ["tsc"] } }),
        createTask({
          type: "git",
          options: {
            params: {
              operation: "syncBaseBranch",
              gitConfig: {
                defaultBranch: "main",
                remote: "origin",
                worktreeBase: ".aq-worktrees",
                branchPrefix: "aq/",
                commitMsgTemplate: "[#{issue}] {title}",
              },
            },
          },
        }),
      ];

      for (const task of tasks) {
        expect(typeof task.kill).toBe("function");
      }
    });

    it("각 createTask 호출마다 고유한 id를 생성한다", () => {
      const t1 = createTask({ type: "claude", options: { prompt: "a", config: mockClaudeConfig } });
      const t2 = createTask({ type: "claude", options: { prompt: "b", config: mockClaudeConfig } });

      expect(t1.id).not.toBe(t2.id);
    });
  });
});
